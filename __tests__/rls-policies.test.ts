import { allSql, loadMigrations } from "./helpers/migrations";

/**
 * RLS enabled must mean RLS enforced. Three separate things can go wrong and
 * each is checked independently: a table with no `enable row level security`,
 * a table with RLS on but no policy (which denies everything, usually by
 * accident), and a policy whose body doesn't actually constrain anything.
 *
 * Tables that are deny-all on purpose go in NO_POLICY_BY_DESIGN and get the
 * INVERSE assertion — they must also have their grants revoked, so "no policy"
 * can never quietly mean "forgot to write one".
 */

/**
 * Shared reference data: readable by every signed-in user regardless of
 * organisation, because it holds no tenant data and must be readable BEFORE
 * an organisation exists. Exempt from the tenancy rules below, and required
 * by the tests further down to be strictly read-only in exchange.
 */
const TENANT_AGNOSTIC_BY_DESIGN = new Set<string>([
  // The catalogue of industries offered at signup.
  "public.industry_templates",
]);

/** RLS on, zero policies, grants revoked from both client roles. Only
 *  SECURITY DEFINER functions may touch these. */
const NO_POLICY_BY_DESIGN = new Set<string>([
  // Gapless counters. A client that could increment one directly could burn
  // numbers or forge them, so only SECURITY DEFINER functions reach it.
  "public.document_sequences",
]);

interface Policy {
  key: string;
  table: string;
  name: string;
  body: string;
}

function livePolicies(): Map<string, Policy> {
  const live = new Map<string, Policy>();
  for (const m of loadMigrations()) {
    for (const stmt of m.sql.split(";")) {
      const drop = /drop\s+policy\s+if\s+exists\s+"([^"]+)"\s+on\s+([a-z_.]+)/i.exec(stmt);
      if (drop) {
        live.delete(`${drop[2]}.${drop[1]}`);
        continue;
      }
      const create = /create\s+policy\s+"([^"]+)"\s+on\s+([a-z_.]+)([\s\S]*)/i.exec(stmt);
      if (create) {
        const key = `${create[2]}.${create[1]}`;
        live.set(key, { key, table: create[2], name: create[1], body: create[3] });
      }
    }
  }
  return live;
}

function createdTables(): string[] {
  const matches = allSql().matchAll(/create\s+table\s+if\s+not\s+exists\s+(public\.[a-z_]+)/gi);
  return [...new Set([...matches].map((m) => m[1]))].sort();
}

describe("RLS policies", () => {
  const sql = allSql();
  const tables = createdTables();
  const policies = livePolicies();

  it("has migrations to check (guards must never pass vacuously)", () => {
    expect(loadMigrations().length).toBeGreaterThan(0);
  });

  it("every table enables row level security", () => {
    const offenders = tables.filter((t) => {
      const re = new RegExp(`alter\\s+table\\s+${t.replace(".", "\\.")}\\s+enable\\s+row\\s+level\\s+security`, "i");
      return !re.test(sql);
    });
    expect(offenders).toEqual([]);
  });

  it("every table has a policy, or is deny-all by design", () => {
    const offenders: { table: string; policies: number }[] = [];
    for (const table of tables) {
      const own = [...policies.values()].filter((p) => p.table === table);
      if (NO_POLICY_BY_DESIGN.has(table)) {
        if (own.length !== 0) offenders.push({ table, policies: own.length });
      } else if (own.length === 0) {
        offenders.push({ table, policies: 0 });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("deny-all tables revoke from authenticated too", () => {
    const offenders = [...NO_POLICY_BY_DESIGN].filter((t) => {
      const re = new RegExp(`revoke\\s+all\\s+on\\s+${t.replace(".", "\\.")}\\s+from[^;]*authenticated`, "i");
      return !re.test(sql);
    });
    expect(offenders).toEqual([]);
  });

  it("no policy is an unscoped `using (true)` unless declared tenant-agnostic", () => {
    const offenders = [...policies.values()]
      .filter((p) => !TENANT_AGNOSTIC_BY_DESIGN.has(p.table))
      .filter((p) => /using\s*\(\s*true\s*\)/i.test(p.body))
      .map((p) => p.key);
    expect(offenders).toEqual([]);
  });

  it("tenant-agnostic tables are strictly read-only", () => {
    // The other half of the bargain: if a table is readable by everyone, no
    // client role may write it, or "shared reference data" becomes a hole
    // every tenant can push rows through.
    const offenders: { table: string; problem: string }[] = [];
    for (const table of TENANT_AGNOSTIC_BY_DESIGN) {
      const own = [...policies.values()].filter((p) => p.table === table);
      for (const p of own) {
        if (!/for\s+select/i.test(p.body)) offenders.push({ table, problem: `non-select policy ${p.name}` });
      }
      const grant = new RegExp(`grant\\s+([a-z,\\s]+)\\s+on\\s+${table.replace(".", "\\.")}\\s+to`, "gi");
      for (const m of sql.matchAll(grant)) {
        if (/insert|update|delete/i.test(m[1])) offenders.push({ table, problem: `write grant: ${m[1].trim()}` });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every policy names a role rather than applying to PUBLIC", () => {
    const offenders = [...policies.values()]
      .filter((p) => !/\bto\s+(authenticated|anon|service_role)\b/i.test(p.body))
      .map((p) => p.key);
    expect(offenders).toEqual([]);
  });

  it("every policy constrains rows by tenancy or by the caller's own id", () => {
    const offenders = [...policies.values()]
      .filter((p) => !TENANT_AGNOSTIC_BY_DESIGN.has(p.table))
      .filter((p) => !/current_org_id\(\)|auth\.uid\(\)/i.test(p.body))
      .map((p) => p.key);
    expect(offenders).toEqual([]);
  });

  it("every policy calls its helpers as hoisted subselects", () => {
    // `(select public.current_org_id())` is an InitPlan evaluated once per
    // query; the bare call is re-evaluated once per row. Strip every correctly
    // wrapped call, then assert nothing bare survives — so a policy that mixes
    // both forms is still caught.
    const HELPERS = ["public.current_org_id", "public.current_role_name", "public.has_role", "auth.uid"];
    const offenders: { policy: string; bare: string }[] = [];

    for (const p of policies.values()) {
      let stripped = p.body;
      for (const h of HELPERS) {
        const esc = h.replace(".", "\\.");
        stripped = stripped.replace(new RegExp(`\\(\\s*select\\s+${esc}\\s*\\([^)]*\\)\\s*\\)`, "gi"), "");
      }
      for (const h of HELPERS) {
        const esc = h.replace(".", "\\.");
        if (new RegExp(`${esc}\\s*\\(`, "i").test(stripped)) {
          offenders.push({ policy: p.key, bare: h });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every `for update` and `for all` policy carries both using and with check", () => {
    const offenders = [...policies.values()]
      .filter((p) => /\bfor\s+(update|all)\b/i.test(p.body))
      .filter((p) => !(/\busing\s*\(/i.test(p.body) && /\bwith\s+check\s*\(/i.test(p.body)))
      .map((p) => p.key);
    expect(offenders).toEqual([]);
  });
});
