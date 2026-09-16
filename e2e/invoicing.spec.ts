import { test, expect } from "./fixtures";
import { addParty, activityTypeId, recordActivity, issueInvoice, documentTaxes, trip } from "./helpers/seed";

/**
 * Turning recorded work into an invoice.
 *
 * The tax assertions are the point. An intra-region sale and an inter-region
 * sale of the SAME value must come to the same total and differ only in how
 * the tax is named — that is what makes `document_taxes` rows the right shape
 * and a fixed cgst/sgst/igst column set the wrong one.
 */
test.describe("issuing invoices", () => {
  test("bills selected work, splitting GST within the seller's own state", async ({ tenant }) => {
    const partyId = await addParty(tenant, {
      name: "Konkan Ceramics", regionCode: "KA", termsDays: 15,
    });
    const typeId = await activityTypeId(tenant, "trip");
    const a = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 38_000_00, occurredOn: "2026-06-10",
      details: trip("Dharwad", "Belagavi", "KA25AB4411"),
    });
    const b = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 52_500_00, occurredOn: "2026-06-11",
      details: trip("Dharwad", "Mangaluru", "KA25CD7788"),
    });

    await tenant.page.goto("/documents/new");
    await tenant.page.getByLabel("Who are you billing?").selectOption(partyId);

    // The billable list carries this industry's own fields, with no
    // industry-specific code anywhere in the page.
    await expect(
      tenant.page.getByText("Origin: Dharwad · Destination: Belagavi", { exact: false }),
    ).toBeVisible();

    await tenant.page.locator('input[type="checkbox"]').nth(0).check();
    await tenant.page.locator('input[type="checkbox"]').nth(1).check();
    await expect(tenant.page.getByText("2 items, taxable value")).toBeVisible();
    await expect(tenant.page.getByText("₹90,500.00")).toBeVisible();

    // The due date follows the party's terms rather than being typed.
    const docDate = await tenant.page.getByLabel("Invoice date").inputValue();
    const expectedDue = new Date(`${docDate}T00:00:00Z`);
    expectedDue.setUTCDate(expectedDue.getUTCDate() + 15);
    await expect(tenant.page.getByLabel("Due")).toHaveValue(expectedDue.toISOString().slice(0, 10));

    await tenant.page.getByRole("button", { name: "Issue invoice" }).click();
    await expect(tenant.page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);

    const body = tenant.page.locator("body");
    await expect(body).toContainText("CGST 9%");
    await expect(body).toContainText("SGST 9%");
    await expect(body).toContainText("₹1,06,790.00");
    await expect(body).toContainText("Vehicle no.: KA25AB4411");

    void a; void b;
  });

  test("an inter-state sale is one combined component for the same total", async ({ tenant }) => {
    const typeId = await activityTypeId(tenant, "trip");
    const near = await addParty(tenant, { name: "Karnataka Cements", regionCode: "KA" });
    const far = await addParty(tenant, { name: "Maharashtra Mills", regionCode: "MH" });

    const intraActivity = await recordActivity(tenant, {
      typeId, partyId: near, amountMinor: 100_000_00, occurredOn: "2026-06-12",
      details: trip("Bengaluru", "Hubballi"),
    });
    const interActivity = await recordActivity(tenant, {
      typeId, partyId: far, amountMinor: 100_000_00, occurredOn: "2026-06-12",
      details: trip("Bengaluru", "Pune"),
    });

    const intra = await issueInvoice(tenant, {
      partyId: near, activityIds: [intraActivity], docDate: "2026-06-30",
    });
    const inter = await issueInvoice(tenant, {
      partyId: far, activityIds: [interActivity], docDate: "2026-06-30",
    });

    expect((await documentTaxes(tenant, intra.documentId)).map((t) => t.component_code))
      .toEqual(["CGST", "SGST"]);
    expect((await documentTaxes(tenant, inter.documentId)).map((t) => t.component_code))
      .toEqual(["IGST"]);

    // The whole argument for per-component rows, in one assertion.
    expect(intra.totalMinor).toBe(inter.totalMinor);
    expect(intra.totalMinor).toBe(118_000_00);
  });

  test("numbers from the financial year the document is dated in, not today", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");

    // India's financial year starts in April, so March and April 2026 are in
    // different years' series. Back-dating must respect that — getting it
    // wrong is a compliance problem that cannot be fixed after issue.
    const march = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 1_000_00, occurredOn: "2026-03-20", details: trip("A", "B"),
    });
    const june = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 1_000_00, occurredOn: "2026-06-20", details: trip("C", "D"),
    });

    const backDated = await issueInvoice(tenant, {
      partyId, activityIds: [march], docDate: "2026-03-31",
    });
    const current = await issueInvoice(tenant, {
      partyId, activityIds: [june], docDate: "2026-06-30",
    });

    expect(backDated.docNo).toBe("INV-2526-000001");
    expect(current.docNo).toBe("INV-2627-000001");
  });

  test("the same work cannot be billed twice", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-12", details: trip("A", "B"),
    });

    await issueInvoice(tenant, { partyId, activityIds: [activityId], docDate: "2026-06-30" });

    const second = await tenant.page.request.post("/api/documents", {
      data: {
        doc_kind: "invoice", counterparty_id: partyId,
        doc_date: "2026-06-30", activity_ids: [activityId],
      },
    });
    expect(second.status(), "double-billing must be refused as a conflict").toBe(409);

    // And the screen agrees — nothing is left to bill.
    await tenant.page.goto("/documents/new");
    await tenant.page.getByLabel("Who are you billing?").selectOption(partyId);
    await expect(tenant.page.getByText("Nothing completed and unbilled")).toBeVisible();
  });

  test("zero tax says which of its three reasons applies", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");

    const exemptActivity = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 50_000_00, occurredOn: "2026-06-12", details: trip("A", "B"),
    });
    const rcmActivity = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 70_000_00, occurredOn: "2026-06-13", details: trip("C", "D"),
    });

    const exempt = await issueInvoice(tenant, {
      partyId, activityIds: [exemptActivity], docDate: "2026-06-30", treatment: "exempt",
    });
    const rcm = await issueInvoice(tenant, {
      partyId, activityIds: [rcmActivity], docDate: "2026-06-30", treatment: "reverse_charge",
    });

    expect(await documentTaxes(tenant, exempt.documentId)).toEqual([]);
    expect(exempt.taxNote).toBe("Exempt / nil-rated — no tax charged.");
    expect(exempt.totalMinor).toBe(50_000_00);

    expect(await documentTaxes(tenant, rcm.documentId)).toEqual([]);
    expect(rcm.taxNote).toBe("Tax payable by the recipient under reverse charge.");
    expect(rcm.totalMinor).toBe(70_000_00);

    // The two must not be conflated on screen: one says the supply is exempt,
    // the other says the customer owes the tax. Different facts.
    await tenant.page.goto(`/documents/${rcm.documentId}`);
    await expect(tenant.page.getByText("Tax payable by the recipient")).toBeVisible();
  });

  test("an invoice cannot be issued with nothing on it", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const res = await tenant.page.request.post("/api/documents", {
      data: {
        doc_kind: "invoice", counterparty_id: partyId,
        doc_date: "2026-06-30", activity_ids: [],
      },
    });
    expect(res.status()).toBe(422);
    expect(await res.text()).toMatch(/at least one item/i);
  });
});
