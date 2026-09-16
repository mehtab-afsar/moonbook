import { allSql, loadMigrations, stripSqlComments } from "./helpers/migrations";
import {
  SQL_PARITY,
  ACTIVITY_STATUSES,
  EDITABLE_ACTIVITY_STATUSES,
} from "@/lib/domain";

/**
 * The SQL and the TypeScript must agree on where every closed set ends.
 *
 * Both directions matter and they fail differently. A value in SQL but not in
 * TypeScript means the database will hand back a row the app cannot label — a
 * blank badge, or a crash in a lookup. A value in TypeScript but not in SQL
 * means the app will offer something the database refuses, and the user meets
 * a constraint violation for choosing an option that was on the screen.
 *
 * Neither announces itself. Both are one line in a migration away.
 */

/** `constraint <name> check (<col> in ('a', 'b'))` → ["a", "b"]. */
function sqlValues(constraintName: string): string[] | null {
  const sql = stripSqlComments(allSql());
  const re = new RegExp(
    `constraint\\s+${constraintName}\\s+check\\s*\\(\\s*[a-z_]+\\s+in\\s*\\(([^)]*)\\)`,
    "i",
  );
  const m = re.exec(sql);
  if (!m) return null;
  return m[1]
    .split(",")
    .map((v) => v.trim().replace(/^'|'$/g, ""))
    .filter((v) => v.length > 0);
}

describe("state machine parity", () => {
  it("has migrations to check (guards must never pass vacuously)", () => {
    expect(loadMigrations().length).toBeGreaterThan(0);
  });

  it("declares a non-trivial set of pairings", () => {
    // Anti-vacuous: an empty or near-empty map would make every `it.each`
    // below pass by iterating nothing.
    expect(Object.keys(SQL_PARITY).length).toBeGreaterThanOrEqual(10);
  });

  it.each(Object.keys(SQL_PARITY))("%s exists in the migrations", (name) => {
    expect(sqlValues(name)).not.toBeNull();
  });

  it.each(Object.entries(SQL_PARITY))(
    "%s matches its TypeScript list exactly",
    (name, values) => {
      // Sorted, because the order a constraint lists its values in is not a
      // fact about the domain and should not fail a build.
      expect([...(sqlValues(name) ?? [])].sort()).toEqual([...values].sort());
    },
  );

  it("every check constraint in the schema is paired with a TypeScript list", () => {
    // The direction that catches a NEW closed set added to SQL alone. Without
    // it, this file only guards the sets someone remembered to register.
    const sql = stripSqlComments(allSql());
    const found = [...sql.matchAll(/constraint\s+([a-z_]+_chk)\s+check\s*\(\s*[a-z_]+\s+in\s*\(/gi)]
      .map((m) => m[1].toLowerCase());

    const unpaired = [...new Set(found)].filter((name) => !(name in SQL_PARITY));
    expect(unpaired).toEqual([]);
  });

  it("the statuses a person may set are a strict subset of all statuses", () => {
    // `invoiced` is set by issue_document alone. If it ever became settable,
    // work could be marked billed with no document behind it.
    for (const s of EDITABLE_ACTIVITY_STATUSES) {
      expect(ACTIVITY_STATUSES).toContain(s);
    }
    expect(EDITABLE_ACTIVITY_STATUSES).not.toContain("invoiced");
    expect(EDITABLE_ACTIVITY_STATUSES.length).toBeLessThan(ACTIVITY_STATUSES.length);
  });
});
