import { test, expect } from "./fixtures";
import {
  addParty, activityTypeId, recordActivity, issueInvoice, recordPayment, balanceOf, trip,
} from "./helpers/seed";

/**
 * The correction paths, through the screens a person actually uses.
 *
 * corrections.spec.ts proves the rules hold at the API. This proves they are
 * REACHABLE — which is the whole point, since every one of these existed in
 * the database and could not be got at from the product.
 */
test.describe("corrections through the UI", () => {
  test("a mistyped amount is corrected from the activity log", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    await recordActivity(tenant, {
      typeId, partyId, amountMinor: 38_000_00, occurredOn: "2026-06-10",
      details: trip("Dharwad", "Belagavi", "KA25AB4411"),
    });

    await tenant.page.goto("/activities");
    await expect(tenant.page.getByText("₹38,000.00")).toBeVisible();

    await tenant.page.getByRole("button", { name: "Correct" }).click();
    await expect(tenant.page.getByText("Correcting Trip for Konkan Ceramics")).toBeVisible();

    // The form comes back filled in, including the industry's own fields.
    await expect(tenant.page.getByLabel("Origin")).toHaveValue("Dharwad");
    await expect(tenant.page.getByLabel("Vehicle no.")).toHaveValue("KA25AB4411");
    // The type cannot change: details are validated against its field schema.
    await expect(tenant.page.getByLabel("What")).toBeDisabled();

    await tenant.page.getByLabel("Amount (INR)").fill("3800");
    await tenant.page.getByRole("button", { name: "Save correction" }).click();

    await expect(tenant.page.getByText("₹3,800.00")).toBeVisible();
    await expect(tenant.page.getByText("₹38,000.00")).toHaveCount(0);
  });

  test("billed work offers no correction, and says why", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });
    await issueInvoice(tenant, { partyId, activityIds: [activityId], docDate: "2026-06-30" });

    await tenant.page.goto("/activities");
    await expect(tenant.page.getByRole("button", { name: "Correct" })).toHaveCount(0);
    await expect(tenant.page.getByText("billed")).toBeVisible();
  });

  test("an unpaid invoice is cancelled from its own page", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });
    const invoice = await issueInvoice(tenant, {
      partyId, activityIds: [activityId], docDate: "2026-06-30",
    });

    await tenant.page.goto(`/documents/${invoice.documentId}`);
    await tenant.page.getByRole("button", { name: "Cancel this invoice" }).click();
    await tenant.page.getByLabel("Why?").fill("Raised against the wrong customer");
    await tenant.page.getByRole("button", { name: "Cancel this invoice" }).click();

    await expect(tenant.page).toHaveURL(/\/documents$/);
    await expect(tenant.page.getByText("Cancelled")).toBeVisible();

    // And the work is free to bill again, for real.
    await tenant.page.goto("/documents/new");
    await tenant.page.getByLabel("Who are you billing?").selectOption(partyId);
    await expect(tenant.page.getByText("Nothing completed and unbilled")).toHaveCount(0);
  });

  test("a part-paid invoice offers a credit note instead of a cancellation", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });
    const invoice = await issueInvoice(tenant, {
      partyId, activityIds: [activityId], docDate: "2026-06-30",
    });
    await recordPayment(tenant, {
      partyId, amountMinor: 5_000_00, paidOn: "2026-07-01",
      allocations: [{ document_id: invoice.documentId, amount_minor: 5_000_00 }],
    });

    await tenant.page.goto(`/documents/${invoice.documentId}`);

    // The action that would always fail is not offered; the reason is.
    await expect(tenant.page.getByRole("button", { name: "Cancel this invoice" })).toHaveCount(0);
    await expect(
      tenant.page.getByText("cannot be cancelled", { exact: false }),
    ).toBeVisible();

    await tenant.page.getByRole("button", { name: "Raise a credit note" }).click();
    await tenant.page.getByLabel("Amount before tax").fill("2000");
    await tenant.page.getByLabel("Why?").fill("Overcharged on the return leg");
    await tenant.page.getByRole("button", { name: "Raise the credit note" }).click();

    // 11,800 − 5,000 paid − 2,360 credited.
    await expect(tenant.page.getByText("₹4,440.00")).toBeVisible();
    expect(await balanceOf(tenant, invoice.documentId)).toBe(4_440_00);

    // The note is a document in its own right, numbered from its own series.
    await tenant.page.goto("/documents");
    await expect(tenant.page.getByText("Credit note", { exact: true })).toBeVisible();
    await expect(tenant.page.getByRole("link", { name: /^CN-/ })).toBeVisible();
  });

  test("money held on account is applied to a later invoice from its page", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Pays In Advance Ltd", regionCode: "KA" });
    await recordPayment(tenant, {
      partyId, amountMinor: 20_000_00, paidOn: "2026-06-01", allocations: [],
    });

    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });
    const invoice = await issueInvoice(tenant, {
      partyId, activityIds: [activityId], docDate: "2026-06-30",
    });

    await tenant.page.goto(`/documents/${invoice.documentId}`);
    await tenant.page.getByRole("button", { name: "Apply credit held" }).click();
    await expect(tenant.page.getByLabel("What to apply")).toContainText("₹20,000.00 available");

    await tenant.page.getByLabel("How much").fill("11800");
    await tenant.page.getByRole("button", { name: "Apply it" }).click();

    await expect(tenant.page.getByText("Settled")).toBeVisible();
    expect(await balanceOf(tenant, invoice.documentId)).toBe(0);

    await tenant.page.goto("/payments");
    await expect(tenant.page.getByRole("cell", { name: "₹8,200.00" })).toBeVisible();
  });
});
