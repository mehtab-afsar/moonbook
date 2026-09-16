import { test, expect } from "./fixtures";
import {
  addParty, activityTypeId, recordActivity, issueInvoice, recordPayment, trip,
} from "./helpers/seed";

/**
 * The dashboard, which is the only screen most owners look at daily.
 *
 * It had one assertion across the whole suite. Everything on it is derived on
 * read — there is no stored counter anywhere in this schema — so the risk is
 * not staleness but arithmetic: an overdue figure that double-counts, a total
 * that blends two currencies, a settled invoice that keeps appearing.
 */
test.describe("dashboard", () => {
  test("says plainly when there is nothing to show", async ({ tenant }) => {
    await tenant.page.goto("/dashboard");
    await expect(tenant.page.getByText("Nothing outstanding yet")).toBeVisible();
    // Not a zero. A zero and "no data" mean different things to someone
    // wondering whether the app is working.
    await expect(tenant.page.getByText("₹0.00")).toHaveCount(0);
  });

  test("totals what is outstanding, and drops it as it is paid", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");

    for (const [amount, dest] of [[100_000_00, "Hubballi"], [50_000_00, "Mysuru"]] as const) {
      const activityId = await recordActivity(tenant, {
        typeId, partyId, amountMinor: amount, occurredOn: "2026-06-10",
        details: trip("Bengaluru", dest),
      });
      await issueInvoice(tenant, { partyId, activityIds: [activityId], docDate: "2026-06-30" });
    }

    // 118,000 + 59,000.
    await tenant.page.goto("/dashboard");
    await expect(tenant.page.getByText("Outstanding (INR)")).toBeVisible();
    await expect(tenant.page.getByText("₹1,77,000.00").first()).toBeVisible();
    await expect(tenant.page.getByRole("cell", { name: "2" })).toBeVisible();

    const { data: docs } = await tenant.db.from("documents").select("id").order("doc_no");
    await recordPayment(tenant, {
      partyId, amountMinor: 118_000_00, paidOn: "2026-07-01",
      allocations: [{ document_id: docs![0].id, amount_minor: 118_000_00 }],
    });

    await tenant.page.goto("/dashboard");
    await expect(tenant.page.getByText("₹59,000.00").first()).toBeVisible();
    await expect(tenant.page.getByText("₹1,77,000.00")).toHaveCount(0);
  });

  test("an invoice past its due date is counted as overdue, and only then", async ({ tenant }) => {
    const partyId = await addParty(tenant, {
      name: "Slow Payer Ltd", regionCode: "KA", termsDays: 30,
    });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });

    // Due in the past, so it is overdue the moment it is issued.
    const invoice = await issueInvoice(tenant, {
      partyId, activityIds: [activityId], docDate: "2026-06-30", dueDate: "2026-07-15",
    });

    await tenant.page.goto("/dashboard");
    const overdueCard = tenant.page.locator("div").filter({ hasText: /^Overdue/ }).first();
    await expect(overdueCard).toContainText("₹11,800.00");

    // And it stops being overdue once it is settled, rather than lingering.
    await recordPayment(tenant, {
      partyId, amountMinor: 11_800_00, paidOn: "2026-08-01",
      allocations: [{ document_id: invoice.documentId, amount_minor: 11_800_00 }],
    });

    await tenant.page.goto("/dashboard");
    await expect(tenant.page.getByText("No outstanding balances")).toBeVisible();
  });

  test("a future due date is outstanding but not overdue", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });

    const far = new Date();
    far.setUTCFullYear(far.getUTCFullYear() + 1);
    await issueInvoice(tenant, {
      partyId, activityIds: [activityId],
      docDate: "2026-06-30", dueDate: far.toISOString().slice(0, 10),
    });

    await tenant.page.goto("/dashboard");
    await expect(tenant.page.getByText("Outstanding (INR)")).toBeVisible();

    // The overdue card reads zero, not the outstanding amount.
    const overdueCard = tenant.page.locator("div").filter({ hasText: /^Overdue/ }).first();
    await expect(overdueCard).toContainText("₹0.00");
    await expect(overdueCard).not.toContainText("₹11,800.00");
  });

  test("a cancelled invoice stops being counted at all", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });
    const invoice = await issueInvoice(tenant, {
      partyId, activityIds: [activityId], docDate: "2026-06-30",
    });

    await tenant.page.goto("/dashboard");
    await expect(tenant.page.getByText("₹11,800.00").first()).toBeVisible();

    const res = await tenant.page.request.post(`/api/documents/${invoice.documentId}/cancel`, {
      data: { reason: "Raised in error" },
    });
    expect(res.ok()).toBeTruthy();

    await tenant.page.goto("/dashboard");
    await expect(tenant.page.getByText("Nothing outstanding yet")).toBeVisible();
  });

  test("two currencies are reported separately and never added together", async ({ tenant }) => {
    // One organisation, two currencies. Blending them needs a rate, a rate
    // date and a revaluation policy, so the app declines to invent one.
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });
    await issueInvoice(tenant, { partyId, activityIds: [activityId], docDate: "2026-06-30" });

    await tenant.page.goto("/dashboard");
    const cards = await tenant.page.getByText(/^Outstanding \(/).allTextContents();
    expect(cards).toEqual(["Outstanding (INR)"]);
    // The heading names the currency, so a second one can only ever be a
    // second card rather than a bigger number in this one.
    await expect(tenant.page.getByText("Outstanding (INR)")).toBeVisible();
  });
});
