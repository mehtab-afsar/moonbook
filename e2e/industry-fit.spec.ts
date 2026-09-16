import { test, expect } from "./fixtures";
import { addParty, activityTypeId, recordActivity, issueInvoice, documentTaxes } from "./helpers/seed";

/**
 * Does one codebase actually serve four industries?
 *
 * Not "does it run" — whether the shape of each business survives contact with
 * the model. Each of these onboards a real template, records what that trade
 * actually records, bills it and takes the money, and then pushes on the part
 * most likely to break.
 *
 * Where something does not fit, the test says so out loud rather than being
 * written around. A failing expectation is more useful than a passing one that
 * avoided the question.
 */
test.describe("industry fit", () => {
  // ── Logistics ─────────────────────────────────────────────────────────────
  test("logistics: a trip is billed to whoever booked it", async ({ newTenant }) => {
    const t = await newTenant({ templateKey: "freight", label: "Roadlines" });
    const customer = await addParty(t, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(t, "trip");

    const a = await recordActivity(t, {
      typeId, partyId: customer, amountMinor: 38_000_00, occurredOn: "2026-06-04",
      details: { origin: "Pune", destination: "Nashik", vehicle_no: "MH12AB1122", load_type: "Full truckload" },
    });
    const inv = await issueInvoice(t, { partyId: customer, activityIds: [a], docDate: "2026-06-30" });

    expect(inv.totalMinor).toBe(44_840_00);
    const { data: doc } = await t.db
      .from("documents").select("issued_snapshot").eq("id", inv.documentId).single();
    const printed = doc!.issued_snapshot.lines[0].printable_details as { label: string }[];
    expect(printed.map((d) => d.label)).toEqual(["Origin", "Destination", "Vehicle no.", "Load type"]);
  });

  // ── Scrap ─────────────────────────────────────────────────────────────────
  test("scrap: buys by weight in one direction and sells in the other", async ({ newTenant }) => {
    const t = await newTenant({ templateKey: "scrap", label: "Recyclers" });
    const collector = await addParty(t, { name: "Ward 12 Co-op", regionCode: "KA" });
    const processor = await addParty(t, { name: "Mysuru Polymers", regionCode: "KA" });

    const inType = await activityTypeId(t, "material_in");
    const outType = await activityTypeId(t, "material_out");

    // The amount is never typed — it is the product of two recorded fields.
    const purchase = await t.page.request.post("/api/activities", {
      data: {
        activity_type_id: inType, party_id: collector, occurred_on: "2026-06-05",
        details: { material: "PET", grade: "B", net_weight_kg: 1840, rate_per_kg: 22, ticket_no: "WB-4412" },
      },
    });
    expect(purchase.ok(), await purchase.text()).toBeTruthy();

    const sale = await t.page.request.post("/api/activities", {
      data: {
        activity_type_id: outType, party_id: processor, occurred_on: "2026-06-12",
        details: { material: "PET flake", grade: "A", net_weight_kg: 1600, rate_per_kg: 48 },
      },
    });
    expect(sale.ok()).toBeTruthy();

    const { data } = await t.db
      .from("activities").select("direction, amount_minor").order("occurred_on");
    // 1840 × ₹22 = ₹40,480 owed out; 1600 × ₹48 = ₹76,800 owed in.
    expect(data).toEqual([
      { direction: "payable", amount_minor: 40_480_00 },
      { direction: "receivable", amount_minor: 76_800_00 },
    ]);

    // Both ledgers are kept, and never netted against each other.
    const { data: ready } = await t.db
      .from("party_ready_to_bill").select("direction, pending_amount_minor").order("direction");
    expect(ready!.map((r) => r.direction)).toEqual(["payable", "receivable"]);
  });

  // ── Wholesale ─────────────────────────────────────────────────────────────
  test("wholesale: many products on one invoice, each its own line", async ({ newTenant }) => {
    const t = await newTenant({ templateKey: "wholesale", label: "Trading Co" });
    const retailer = await addParty(t, { name: "Shree Provision Stores", regionCode: "KA" });
    const typeId = await activityTypeId(t, "goods_out");

    const ids: string[] = [];
    for (const [product, sku, units, price] of [
      ["Refined sunflower oil", "OIL-SF-1L", 144, 132],
      ["Toor dal", "PUL-TD-1K", 200, 148],
      ["Basmati rice", "RIC-BS-5K", 60, 520],
    ] as const) {
      const res = await t.page.request.post("/api/activities", {
        data: {
          activity_type_id: typeId, party_id: retailer, occurred_on: "2026-06-10",
          details: { product, sku, units, unit_price: price },
        },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      ids.push((await res.json()).data.activity_id);
    }

    const inv = await issueInvoice(t, { partyId: retailer, activityIds: ids, docDate: "2026-06-30" });

    const { data: doc } = await t.db
      .from("documents").select("issued_snapshot, taxable_value_minor").eq("id", inv.documentId).single();
    // 19,008 + 29,600 + 31,200.
    expect(doc!.taxable_value_minor).toBe(79_808_00);
    expect(doc!.issued_snapshot.lines).toHaveLength(3);
    expect(
      doc!.issued_snapshot.lines.map(
        (l: { printable_details: { label: string; value: string }[] }) =>
          l.printable_details.find((d) => d.label === "Product")?.value,
      ),
    ).toEqual(["Refined sunflower oil", "Toor dal", "Basmati rice"]);
  });

  test("wholesale: goods at DIFFERENT tax rates on one invoice", async ({ newTenant }) => {
    // The case that decides whether wholesale is served at all. In India
    // edible oil is 5%, packaged rice 5%, and most groceries 18% — a single
    // delivery routinely mixes rates, and the invoice must show each.
    const t = await newTenant({ templateKey: "wholesale", label: "Trading Co" });
    const retailer = await addParty(t, { name: "Shree Provision Stores", regionCode: "KA" });
    const typeId = await activityTypeId(t, "goods_out");

    const ids: string[] = [];
    for (const [product, units, price] of [
      ["Refined sunflower oil", 100, 132],   // 5% in reality
      ["Detergent powder", 50, 240],          // 18% in reality
    ] as const) {
      const res = await t.page.request.post("/api/activities", {
        data: {
          activity_type_id: typeId, party_id: retailer, occurred_on: "2026-06-10",
          details: { product, units, unit_price: price },
        },
      });
      ids.push((await res.json()).data.activity_id);
    }

    const inv = await issueInvoice(t, { partyId: retailer, activityIds: ids, docDate: "2026-06-30" });
    const taxes = await documentTaxes(t, inv.documentId);

    // Both lines are taxed at the organisation's single default rate. There is
    // one tax_treatment and one taxable_value_minor per document, and
    // document_lines carries no rate of its own, so a mixed-rate invoice
    // cannot be expressed. This asserts the LIMIT, so that the day per-line
    // tax is built, this test fails and has to be rewritten deliberately.
    expect(taxes.every((c) => c.rate_pct === 9)).toBeTruthy();
    expect(taxes.map((c) => c.component_code)).toEqual(["CGST", "SGST"]);
    // 13,200 + 12,000 = 25,200, all at 18%.
    expect(inv.totalMinor).toBe(29_736_00);
  });

  // ── Hospitality ───────────────────────────────────────────────────────────
  test("hospitality: an account customer's orders bill like anything else", async ({ newTenant }) => {
    const t = await newTenant({ templateKey: "hospitality", label: "Café" });
    const corporate = await addParty(t, { name: "Innosphere Ventures", regionCode: "KA", termsDays: 30 });
    const typeId = await activityTypeId(t, "order");

    const ids: string[] = [];
    for (const [type, covers, amount, ref] of [
      ["Catering", 40, 18_500_00, "CAT-091"],
      ["Function", 120, 64_000_00, "FN-014"],
    ] as const) {
      ids.push(await recordActivity(t, {
        typeId, partyId: corporate, amountMinor: amount, occurredOn: "2026-06-03",
        reference: ref, details: { order_type: type, covers, served_on: "2026-06-03" },
      }));
    }

    const inv = await issueInvoice(t, { partyId: corporate, activityIds: ids, docDate: "2026-06-30" });
    expect(inv.totalMinor).toBe(97_350_00);

    const { data: doc } = await t.db
      .from("documents").select("issued_snapshot").eq("id", inv.documentId).single();
    expect(doc!.issued_snapshot.lines).toHaveLength(2);
  });

  test("hospitality: a counter sale with no customer cannot be recorded", async ({ newTenant }) => {
    // A café's actual volume is walk-ins: a flat white, paid in cash, to
    // nobody in particular. `activities.party_id` is NOT NULL, so there is
    // nowhere to put "no one" — and inventing a "Walk-in" party would put
    // every cash sale in the year against a single customer's ledger and its
    // outstanding balance.
    //
    // This is a genuine limit, not an oversight: the ledger is built around
    // who owes what, and a counter sale creates no debt. It belongs in a till.
    const t = await newTenant({ templateKey: "hospitality", label: "Café" });
    const typeId = await activityTypeId(t, "order");

    const { error } = await t.db.rpc("record_activity", {
      p_activity_type_id: typeId,
      p_party_id: null as unknown as string,
      p_occurred_on: "2026-06-03",
      p_amount_minor: 3_20_00,
      p_details: { order_type: "Account tab" } as never,
      p_status: "completed",
    });
    expect(error, "a party is currently mandatory — see docs/INDUSTRY-FIT.md").not.toBeNull();
  });

  // ── The claim itself ──────────────────────────────────────────────────────
  test("all five industries are offered, and none of them is in the code", async ({ tenant }) => {
    const { data: templates } = await tenant.db
      .from("industry_templates").select("key").order("sort_order");
    expect(templates!.map((t) => t.key)).toEqual([
      "freight", "scrap", "hospitality", "wholesale", "generic",
    ]);

    // No industry name appears in the CODE of the application, the tax engine
    // or the renderer. If one ever does, the thesis has quietly stopped being
    // true — a branch on "if this is a scrap yard" is the whole thing failing.
    //
    // Comments are stripped first and deliberately. "Origin and Destination
    // for a freight operator, Material grade and Weight for a scrap yard" is
    // documentation doing its job: it tells a reader what the abstraction is
    // FOR. A guard that banned the words would push that explanation out of
    // the codebase and teach nothing.
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(path)) files.push(path);
      }
    };
    for (const root of ["lib", "app/api", "features"]) walk(root);

    const INDUSTRY = /\b(scrap|wholesal\w*|hospitality|caf[eé]|freight)\b/i;
    const offenders: { file: string; line: number; text: string }[] = [];

    for (const file of files) {
      const src = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments, including JSDoc
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // line comments, sparing URLs
      src.split("\n").forEach((text, i) => {
        if (INDUSTRY.test(text)) offenders.push({ file, line: i + 1, text: text.trim() });
      });
    }

    expect(offenders, "an industry name has leaked into the code").toEqual([]);
  });
});
