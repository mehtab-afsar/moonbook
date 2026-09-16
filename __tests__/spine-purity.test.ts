import { allSql, loadMigrations } from "./helpers/migrations";

/**
 * THE ARCHITECTURE'S LOAD-BEARING INVARIANT, asserted mechanically.
 *
 * Moonbook serves many industries from one schema because financial logic
 * reads a TYPED SPINE — party, date, amount, currency, direction, status — and
 * never the free-shaped `details` that makes one industry differ from another.
 *
 * If a view, a balance, or a report ever reads `details`, that guarantee is
 * gone: the ledger now depends on a shape that varies per customer, and
 * "does this work for industry N+1" stops being answerable by reading the
 * schema. It is the kind of thing that gets added in one innocent-looking
 * line, so it is checked rather than remembered.
 */

/** The only places `details` may legitimately appear. */
const ALLOWED = [
  // The column itself, its index, and its comment.
  "20260916000005_activities.sql",
  // record_activity writes it, and extracts the mirrored reportable field.
  "20260916000009_ledger_rpcs.sql",
  // The structural validation trigger, and the dimension rebuild.
  "20260916000010_activity_validation.sql",
  // issue_document, superseded: freezes the printable details onto the
  // document snapshot. The one crossing into the document layer, and it
  // crosses as rendered text — read once at issue, never computed on.
  "20260916000013_document_printable_details.sql",
  // update_activity replaces details wholesale and re-derives the mirrored
  // reportable field, exactly as record_activity does on the way in. A write
  // path, never a read one — nothing financial is computed from it here.
  "20260916000015_update_activity.sql",
  // issue_document, superseded again for the owner guard. It carries the
  // snapshot's printable_details lateral join forward unchanged.
  "20260916000017_owner_only_money.sql",
  // validate_activity_details, superseded so a date field must hold a real
  // date. The trigger reads `details` to check its SHAPE and never its value
  // for any financial purpose — the same standing exception as 0010.
  "20260916000018_date_fields_must_be_dates.sql",
];

/** Every `create [or replace] view ... as <body>;` in the migrations. */
function viewBodies(): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /create\s+(?:or\s+replace\s+)?view\s+(public\.[a-z_]+)([\s\S]*?);/gi;
  for (const m of allSql().matchAll(re)) out.push({ name: m[1], body: m[2] });
  return out;
}

describe("spine purity", () => {
  it("has migrations to check (guards must never pass vacuously)", () => {
    expect(loadMigrations().length).toBeGreaterThan(0);
  });

  it("has views to check (the rule is about views above all)", () => {
    expect(viewBodies().length).toBeGreaterThan(0);
  });

  it("no view reads `details`", () => {
    const offenders = viewBodies()
      .filter((v) => /\bdetails\b/i.test(v.body))
      .map((v) => v.name);
    expect(offenders).toEqual([]);
  });

  it("`details` appears only in the files allowed to touch it", () => {
    const offenders = loadMigrations()
      .filter((m) => /\bdetails\b/i.test(m.sql))
      .map((m) => m.file)
      .filter((file) => !ALLOWED.includes(file));
    expect(offenders).toEqual([]);
  });

  it("every file on the allowlist actually still uses it", () => {
    // A stale allowlist entry is how an allowlist stops meaning anything.
    const used = new Set(
      loadMigrations().filter((m) => /\bdetails\b/i.test(m.sql)).map((m) => m.file),
    );
    const stale = ALLOWED.filter((f) => !used.has(f));
    expect(stale).toEqual([]);
  });

  it("no balance or outstanding view depends on an activity at all", () => {
    // Balances derive from documents, payments and notes. An activity is what
    // was billed, not what is owed — if the money views start joining to it,
    // the split has been breached in spirit even without the word `details`.
    const moneyViews = ["document_balances", "party_outstanding", "credit_balances", "payment_balances"];
    const offenders = viewBodies()
      .filter((v) => moneyViews.some((n) => v.name.endsWith(n)))
      .filter((v) => /\bpublic\.activities\b/i.test(v.body))
      .map((v) => v.name);
    expect(offenders).toEqual([]);
  });
});
