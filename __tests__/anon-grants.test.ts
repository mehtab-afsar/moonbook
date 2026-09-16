import { allSql, loadMigrations } from "./helpers/migrations";

/**
 * Moonbook has no public surface at all — no tracking links, no share tokens,
 * nothing an unauthenticated caller may reach. The expected anon surface is
 * therefore EMPTY, and adding anything to it means editing this test on
 * purpose rather than by accident.
 *
 * The mechanism matters: rather than checking that individual GRANT statements
 * are absent, this replays every GRANT and REVOKE in migration order into a
 * Set, so a later REVOKE cancels an earlier GRANT. What is asserted is the
 * FINAL reachable surface, which is the only thing that is actually true of
 * the database.
 */

/** Tables service_role is deliberately kept out of. */
const DENIED_TO_SERVICE_ROLE = new Set<string>([
  // Gapless counters: only SECURITY DEFINER functions allocate a number, and
  // they run as the owner regardless of caller, so nothing needs direct
  // access and anything that had it could burn or forge one.
  "public.document_sequences",
]);

interface Reachable {
  functions: string[];
  tables: string[];
}

function anonReachable(): Reachable {
  const functions = new Set<string>();
  const tables = new Set<string>();

  for (const m of loadMigrations()) {
    for (const stmt of m.sql.split(";")) {
      const s = stmt.trim();
      if (!s) continue;

      const isGrant = /^grant\s/i.test(s);
      const isRevoke = /^revoke\s/i.test(s);
      if (!isGrant && !isRevoke) continue;
      if (!/\banon\b/i.test(s)) continue;

      const fn = /on\s+function\s+(public\.[a-z_]+)/i.exec(s);
      const tbl = /on\s+(?:table\s+)?(public\.[a-z_]+)\s+(?:to|from)/i.exec(s);

      if (fn) {
        if (isGrant) functions.add(fn[1]);
        else functions.delete(fn[1]);
      } else if (tbl) {
        if (isGrant) tables.add(tbl[1]);
        else tables.delete(tbl[1]);
      }
    }
  }

  return { functions: [...functions].sort(), tables: [...tables].sort() };
}

function createdTables(): string[] {
  const matches = allSql().matchAll(/create\s+table\s+if\s+not\s+exists\s+(public\.[a-z_]+)/gi);
  return [...new Set([...matches].map((m) => m[1]))].sort();
}

describe("anon grants", () => {
  it("has migrations to check (guards must never pass vacuously)", () => {
    expect(loadMigrations().length).toBeGreaterThan(0);
  });

  it("anon can execute no function", () => {
    expect(anonReachable().functions).toEqual([]);
  });

  it("anon can reach no table", () => {
    expect(anonReachable().tables).toEqual([]);
  });

  it("every created table grants service_role something", () => {
    // Supabase's default privileges give a new table only REFERENCES, TRIGGER
    // and TRUNCATE to service_role — no DML and no SELECT. So the server-only
    // paths (import, seeding, support tooling) silently get "permission
    // denied" unless a grant is written, and a table created in a later
    // migration than the central grants one is exactly how that gets missed.
    const sql = allSql();
    const offenders = createdTables().filter((t) => {
      if (DENIED_TO_SERVICE_ROLE.has(t)) return false;
      const re = new RegExp(`grant\\s+[a-z,\\s]+\\s+on\\s+${t.replace(".", "\\.")}\\s+to[^;]*service_role`, "i");
      return !re.test(sql);
    });
    expect(offenders).toEqual([]);
  });

  it("every created table explicitly revokes from anon", () => {
    const sql = allSql();
    const missing = createdTables().filter((t) => {
      const re = new RegExp(`revoke\\s+all\\s+on\\s+${t.replace(".", "\\.")}\\s+from[^;]*anon`, "i");
      return !re.test(sql);
    });
    expect(missing).toEqual([]);
  });
});
