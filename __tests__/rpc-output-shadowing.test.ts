import { functionBody, loadMigrations, allSql } from "./helpers/migrations";

/**
 * An output column name that shadows a real column.
 *
 * `returns table (document_id uuid)` puts `document_id` in scope for the whole
 * body. Any query that then references a column of the same name WITHOUT
 * qualifying it is ambiguous, and Postgres raises 42702 — but only when the
 * function is CALLED. The migration applies perfectly, `db reset` is green,
 * the guards pass, and the feature fails the first time a user touches it.
 *
 * This has now happened three times across this codebase and its sibling:
 * cancel_document, cancel_invoice and issue_credit_note each shipped with it.
 * Three is a class, not a coincidence.
 *
 * The fix is always the same and always harmless — alias the table and qualify
 * the column — so a false positive here costs one alias, while a false
 * negative costs a broken feature found by a customer.
 */

interface Offender {
  fn: string;
  output: string;
  snippet: string;
}

/** `returns table (a uuid, b text)` → ["a", "b"]. */
function outputsOf(sql: string, fn: string): string[] {
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\([\\s\\S]*?\\)\\s*returns\\s+table\\s*\\(([^)]*)\\)`,
    "i",
  );
  const m = re.exec(sql);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((p) => p.trim().split(/\s+/)[0])
    .filter((n) => /^[a-z_][a-z0-9_]*$/.test(n));
}

/** Every `create or replace function public.<name>` in the migrations. */
function functionNames(): string[] {
  const names = [...allSql().matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z_]+)\s*\(/gi)]
    .map((m) => m[1]);
  return [...new Set(names)];
}

describe("RPC output shadowing", () => {
  it("has migrations to check (guards must never pass vacuously)", () => {
    expect(loadMigrations().length).toBeGreaterThan(0);
  });

  it("found functions that return a table", () => {
    const withOutputs = functionNames().filter((fn) => outputsOf(allSql(), fn).length > 0);
    expect(withOutputs.length).toBeGreaterThan(0);
  });

  it("no function references its own output name as an unqualified column", () => {
    const sql = allSql();
    const offenders: Offender[] = [];

    for (const fn of functionNames()) {
      const outputs = outputsOf(sql, fn);
      if (outputs.length === 0) continue;

      const body = functionBody(fn);
      if (!body) continue;

      for (const output of outputs) {
        // A bare `where document_id = …` or `and document_id = …`. A qualified
        // reference (`b.document_id`) has a dot before it and is not matched;
        // neither is `p_document_id`, nor an INSERT column list, nor an
        // UPDATE … SET assignment, none of which follow WHERE or AND.
        const re = new RegExp(`\\b(where|and)\\s+(?<!\\.)${output}\\s*=`, "gi");
        for (const m of body.matchAll(re)) {
          const at = m.index ?? 0;
          offenders.push({
            fn,
            output,
            snippet: body.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, " ").trim(),
          });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
