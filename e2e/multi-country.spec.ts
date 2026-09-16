import { test, expect } from "./fixtures";
import { addParty, activityTypeId, recordActivity, issueInvoice, documentTaxes, trip } from "./helpers/seed";

/**
 * Three countries in one database, off one code path.
 *
 * The claim is that the difference between a CGST+SGST invoice, an IGST
 * invoice and a VAT invoice is entirely configuration — rows in, rows out —
 * and that no branch on country exists in lib/tax, in issue_document or in the
 * renderer. Every assertion here is about that claim.
 */
test.describe("many countries, one code path", () => {
  test("a British consultancy charges one VAT component", async ({ newTenant }) => {
    const gb = await newTenant({
      country: "GB", regionCode: null, templateKey: "generic", label: "Thames Consulting",
    });

    const partyId = await addParty(gb, { name: "Fenchurch Partners LLP", regionCode: null });
    const typeId = await activityTypeId(gb, "service");
    const activityId = await recordActivity(gb, {
      typeId, partyId, amountMinor: 4_500_00, occurredOn: "2026-06-18",
      reference: "Advisory retainer, June",
    });

    const invoice = await issueInvoice(gb, {
      partyId, activityIds: [activityId], docDate: "2026-06-30",
    });

    const taxes = await documentTaxes(gb, invoice.documentId);
    expect(taxes).toHaveLength(1);
    expect(taxes[0]).toMatchObject({ component_code: "VAT", component_label: "VAT 20%", rate_pct: 20 });
    expect(invoice.totalMinor).toBe(5_400_00);

    // A January financial year gives a calendar-year series, not India's 2627.
    expect(invoice.docNo).toBe("INV-2026-000001");

    // And it renders in pounds, grouped the British way. The taxable value
    // appears twice on purpose — once as the line, once in the totals — so
    // each is asserted where it belongs rather than loosening the match.
    await gb.page.goto(`/documents/${invoice.documentId}`);
    await expect(gb.page.getByRole("cell", { name: "£4,500.00" })).toBeVisible();

    const totals = gb.page.locator("dl");
    await expect(totals).toContainText("Taxable value");
    await expect(totals).toContainText("£4,500.00");
    await expect(totals).toContainText("VAT 20%");
    await expect(totals).toContainText("£900.00");
    await expect(totals).toContainText("£5,400.00");
  });

  test("the UAE at 5% needs no migration, no seed and no code", async ({ newTenant }) => {
    const ae = await newTenant({
      country: "AE", regionCode: null, templateKey: "generic", label: "Dubai Logistics",
    });

    const partyId = await addParty(ae, { name: "Jebel Ali Trading LLC", regionCode: null });
    const typeId = await activityTypeId(ae, "service");
    const activityId = await recordActivity(ae, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-07-02",
    });
    const invoice = await issueInvoice(ae, {
      partyId, activityIds: [activityId], docDate: "2026-07-02",
    });

    const taxes = await documentTaxes(ae, invoice.documentId);
    expect(taxes.map((t) => t.component_label)).toEqual(["VAT 5%"]);
    expect(invoice.totalMinor).toBe(10_500_00);

    const pdf = await ae.page.request.get(`/api/documents/${invoice.documentId}/pdf`);
    expect(pdf.ok()).toBeTruthy();
    expect(Buffer.from(await pdf.body()).length).toBeGreaterThan(3000);
  });

  test("an unregistered business charges no tax at all", async ({ newTenant }) => {
    const us = await newTenant({
      country: "US", regionCode: null, templateKey: "generic", taxId: null, label: "Sole Trader",
    });

    const partyId = await addParty(us, { name: "A Client", regionCode: null });
    const typeId = await activityTypeId(us, "service");
    const activityId = await recordActivity(us, {
      typeId, partyId, amountMinor: 2_000_00, occurredOn: "2026-07-02",
    });
    const invoice = await issueInvoice(us, {
      partyId, activityIds: [activityId], docDate: "2026-07-02",
    });

    // No rows, and the total equals the taxable value exactly.
    expect(await documentTaxes(us, invoice.documentId)).toEqual([]);
    expect(invoice.totalMinor).toBe(2_000_00);

    await us.page.goto(`/documents/${invoice.documentId}`);
    await expect(us.page.getByRole("cell", { name: "$2,000.00" })).toBeVisible();
    // No tax line anywhere, because there is no tax to name.
    await expect(us.page.locator("dl")).not.toContainText("VAT");
  });

  test("two countries' invoices coexist without either knowing", async ({ newTenant }) => {
    const india = await newTenant({ country: "IN", regionCode: "KA", label: "Bharat Freight" });
    const britain = await newTenant({
      country: "GB", regionCode: null, templateKey: "generic", label: "Thames Consulting",
    });

    const inParty = await addParty(india, { name: "Karnataka Cements", regionCode: "KA" });
    const inActivity = await recordActivity(india, {
      typeId: await activityTypeId(india, "trip"), partyId: inParty,
      amountMinor: 100_000_00, occurredOn: "2026-06-12", details: trip("Bengaluru", "Hubballi"),
    });
    const inInvoice = await issueInvoice(india, {
      partyId: inParty, activityIds: [inActivity], docDate: "2026-06-30",
    });

    const gbParty = await addParty(britain, { name: "Fenchurch Partners LLP", regionCode: null });
    const gbActivity = await recordActivity(britain, {
      typeId: await activityTypeId(britain, "service"), partyId: gbParty,
      amountMinor: 4_500_00, occurredOn: "2026-06-18",
    });
    const gbInvoice = await issueInvoice(britain, {
      partyId: gbParty, activityIds: [gbActivity], docDate: "2026-06-30",
    });

    // Two tax shapes, from the same route, in the same database.
    expect((await documentTaxes(india, inInvoice.documentId)).length).toBe(2);
    expect((await documentTaxes(britain, gbInvoice.documentId)).length).toBe(1);

    // Each numbers from its own fiscal calendar, independently.
    expect(inInvoice.docNo).toBe("INV-2627-000001");
    expect(gbInvoice.docNo).toBe("INV-2026-000001");

    // Each dashboard totals in its own currency, and never blends them.
    await india.page.goto("/dashboard");
    await expect(india.page.getByText("Outstanding (INR)")).toBeVisible();
    await expect(india.page.getByText("Outstanding (GBP)")).toHaveCount(0);

    await britain.page.goto("/dashboard");
    await expect(britain.page.getByText("Outstanding (GBP)")).toBeVisible();
    await expect(britain.page.getByText("Outstanding (INR)")).toHaveCount(0);
  });
});
