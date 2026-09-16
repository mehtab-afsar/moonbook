import { allSql, loadMigrations } from "./helpers/migrations";

/**
 * A SECURITY DEFINER function runs as its owner, which is the migration role —
 * a role with BYPASSRLS. Two things must therefore be true of every one of
 * them, and neither is enforced by Postgres:
 *
 *   1. `set search_path = ''`, so an attacker cannot shadow an unqualified
 *      name with their own object and have the elevated function call it.
 *   2. `revoke execute ... from public`, so the elevated function isn't
 *      callable by every role in the database by default.
 *
 * The search_path rule has a consequence worth guarding separately: with an
 * empty search_path, unqualified extension functions fail at CALL time, not at
 * CREATE time — the migration applies cleanly and the feature explodes later.
 */

interface DefinerFn {
  name: string;
  header: string;
}

function definerFunctions(): DefinerFn[] {
  const sql = allSql();
  const out: DefinerFn[] = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+(public\.[a-z_]+)\s*\(([^)]*)\)([\s\S]*?)as\s+\$\$/gi;
  for (const m of sql.matchAll(re)) {
    const [, name, , header] = m;
    if (!/security\s+definer/i.test(header)) continue;
    out.push({ name, header });
  }
  return out;
}

describe("security definer hygiene", () => {
  const sql = allSql();
  const fns = definerFunctions();

  it("has migrations to check (guards must never pass vacuously)", () => {
    expect(loadMigrations().length).toBeGreaterThan(0);
  });

  it("every SECURITY DEFINER function sets an empty search_path", () => {
    const offenders = fns
      .filter((f) => !/set\s+search_path\s*=\s*''/i.test(f.header))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it("every SECURITY DEFINER function revokes execute from public", () => {
    const offenders = fns
      .filter((f) => {
        const re = new RegExp(
          `revoke\\s+execute\\s+on\\s+function\\s+${f.name.replace(".", "\\.")}[^;]*from\\s+public`,
          "i",
        );
        return !re.test(sql);
      })
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it("pgcrypto functions are schema-qualified", () => {
    // gen_random_bytes lives in the extensions schema; unqualified it resolves
    // to nothing under `search_path = ''`.
    const bad = [...sql.matchAll(/(?<!extensions\.)\bgen_random_bytes\s*\(/g)].map((m) => m[0]);
    expect(bad).toEqual([]);
  });

  it("gen_random_uuid is NOT schema-qualified", () => {
    // It is core Postgres (13+), not pgcrypto — qualifying it with
    // `extensions.` is the mirror-image mistake and fails the same way.
    const bad = [...sql.matchAll(/extensions\.gen_random_uuid\s*\(/g)].map((m) => m[0]);
    expect(bad).toEqual([]);
  });
});
