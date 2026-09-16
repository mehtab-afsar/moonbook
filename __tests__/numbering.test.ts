import { allSql, loadMigrations } from "./helpers/migrations";

/**
 * You number what you issue.
 *
 * `document_series.is_self_numbered` decides whether issue_document allocates
 * a number of ours or demands the counterparty's. Get it backwards and the
 * document becomes impossible to raise: numbering refuses, and the fallback
 * asks for a number the other party never assigned, because they were never
 * involved.
 *
 * That shipped for `debit_note` and survived until someone read the settings
 * page, because payables have no UI to exercise it. It is a one-word mistake
 * with no runtime symptom until the day it matters, so it is checked.
 */

/** Which side raises each kind of document. */
const RAISED_BY_US: Record<string, boolean> = {
  // We bill a customer.
  invoice: true,
  // We credit a customer, reducing what they owe us.
  credit_note: true,
  // We debit a supplier, reducing what we owe them. Ours, despite sitting in
  // the payable direction — `direction` is whose ledger, not whose document.
  debit_note: true,
  // The supplier bills us. Theirs, and the only one of the four that is.
  bill: false,
};

/**
 * The seeded series from the newest `create_organisation`, as
 * `(v_org, 'invoice', …, true)` tuples. Migrations are read in apply order, so
 * a later supersede wins — the same rule Postgres applies.
 */
function seededSeries(): Map<string, boolean> {
  const seeded = new Map<string, boolean>();
  for (const m of loadMigrations()) {
    const insert = /insert\s+into\s+public\.document_series\s*\([^)]*\)\s*values([\s\S]*?);/i.exec(m.sql);
    if (!insert) continue;
    const rows = insert[1].matchAll(/\(\s*v_org\s*,\s*'([a-z_]+)'\s*,[^,]+,\s*(true|false)\s*\)/gi);
    for (const [, kind, self] of rows) seeded.set(kind, self.toLowerCase() === "true");
  }
  return seeded;
}

describe("document numbering", () => {
  const seeded = seededSeries();

  it("has migrations to check (guards must never pass vacuously)", () => {
    expect(loadMigrations().length).toBeGreaterThan(0);
  });

  it("seeds a series for every document kind the schema allows", () => {
    // Read the kinds from the check constraint rather than restating them, so
    // adding a fifth kind fails here until its series is seeded too.
    const chk = /document_series_kind_chk\s+check\s*\(\s*doc_kind\s+in\s*\(([^)]*)\)/i.exec(allSql());
    expect(chk).not.toBeNull();
    const kinds = [...chk![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect([...seeded.keys()].sort()).toEqual(kinds);
  });

  it("every kind we raise ourselves is self-numbered, and only those", () => {
    const wrong = [...seeded.entries()]
      .filter(([kind, self]) => RAISED_BY_US[kind] !== self)
      .map(([kind, self]) => ({ kind, is_self_numbered: self, should_be: RAISED_BY_US[kind] }));
    expect(wrong).toEqual([]);
  });

  it("the table it covers knows about all four kinds too", () => {
    // Anti-vacuous: if the regex above ever stops matching, `seeded` empties
    // and the rule passes by finding nothing.
    expect(seeded.size).toBe(Object.keys(RAISED_BY_US).length);
  });
});
