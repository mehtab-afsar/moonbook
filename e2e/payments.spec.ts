import { test, expect } from "./fixtures";
import {
  addParty, activityTypeId, recordActivity, issueInvoice, recordPayment, balanceOf, trip,
} from "./helpers/seed";

/**
 * Money in, and what it settles.
 *
 * The over-allocation test is the one that matters most. LedgerFlow validates
 * an allocation against the RECEIPT total but never against the target
 * invoice's balance, so a ₹50,000 allocation against a ₹10,000 invoice drives
 * the balance to −40,000 and nothing complains. Moonbook's `allocate()` locks
 * the target and refuses; this proves it still does.
 */
async function invoiceFor(tenant: Parameters<typeof addParty>[0], amountMinor: number, seq: number) {
  const partyId = await addParty(tenant, { name: `Customer ${seq}`, regionCode: "KA" });
  const typeId = await activityTypeId(tenant, "trip");
  const activityId = await recordActivity(tenant, {
    typeId, partyId, amountMinor, occurredOn: "2026-06-12", details: trip("A", `B${seq}`),
  });
  const invoice = await issueInvoice(tenant, {
    partyId, activityIds: [activityId], docDate: "2026-06-30",
  });
  return { partyId, invoice };
}

test.describe("payments", () => {
  test("one receipt settles two invoices and keeps the change as credit", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Godavari Polymers", regionCode: "MH" });
    const typeId = await activityTypeId(tenant, "trip");

    const first = await issueInvoice(tenant, {
      partyId,
      activityIds: [await recordActivity(tenant, {
        typeId, partyId, amountMinor: 40_000_00, occurredOn: "2026-06-10", details: trip("Pune", "Nashik"),
      })],
      docDate: "2026-06-30",
    });
    const second = await issueInvoice(tenant, {
      partyId,
      activityIds: [await recordActivity(tenant, {
        typeId, partyId, amountMinor: 30_000_00, occurredOn: "2026-06-11", details: trip("Pune", "Aurangabad"),
      })],
      docDate: "2026-06-30",
    });

    // Inter-state from Karnataka: 18% IGST. 47,200 + 35,400 = 82,600.
    expect(first.totalMinor).toBe(47_200_00);
    expect(second.totalMinor).toBe(35_400_00);

    await tenant.page.goto("/payments");
    await tenant.page.getByLabel("Who paid?").selectOption(partyId);
    await tenant.page.getByLabel("Amount received").fill("90000");

    // Allocated oldest-first without being asked, and the remainder is named
    // rather than quietly absorbed.
    await expect(tenant.page.getByText("What does this settle?")).toBeVisible();
    await expect(
      tenant.page.getByText("₹7,400.00 will be left unapplied", { exact: false }),
    ).toBeVisible();

    await tenant.page.getByRole("button", { name: "Record receipt" }).click();
    await expect(tenant.page.getByRole("cell", { name: "₹7,400.00" })).toBeVisible();

    expect(await balanceOf(tenant, first.documentId)).toBe(0);
    expect(await balanceOf(tenant, second.documentId)).toBe(0);

    await tenant.page.goto("/documents");
    await expect(tenant.page.getByText("Settled")).toHaveCount(2);
  });

  test("a part payment leaves the invoice part paid, with the exact remainder", async ({ tenant }) => {
    const { partyId, invoice } = await invoiceFor(tenant, 100_000_00, 1);
    expect(invoice.totalMinor).toBe(118_000_00);

    const res = await recordPayment(tenant, {
      partyId, amountMinor: 50_000_00, paidOn: "2026-07-01",
      allocations: [{ document_id: invoice.documentId, amount_minor: 50_000_00 }],
    });
    expect(res.ok()).toBeTruthy();

    expect(await balanceOf(tenant, invoice.documentId)).toBe(68_000_00);

    await tenant.page.goto(`/documents/${invoice.documentId}`);
    await expect(tenant.page.getByText("Part paid")).toBeVisible();
    await expect(tenant.page.getByText("₹68,000.00")).toBeVisible();
  });

  test("an allocation cannot exceed what the invoice still owes", async ({ tenant }) => {
    const { partyId, invoice } = await invoiceFor(tenant, 10_000_00, 2);
    expect(invoice.totalMinor).toBe(11_800_00);

    const res = await recordPayment(tenant, {
      partyId, amountMinor: 50_000_00, paidOn: "2026-07-01",
      allocations: [{ document_id: invoice.documentId, amount_minor: 50_000_00 }],
    });

    expect(res.ok(), "over-allocation must be refused").toBeFalsy();
    expect(await res.text()).toMatch(/exceed|still owed|owed on this document/i);

    // Nothing partially applied, and above all no negative balance.
    expect(await balanceOf(tenant, invoice.documentId)).toBe(11_800_00);
    const { data: payments } = await tenant.db.from("payments").select("id");
    expect(payments, "a refused allocation must not leave a payment behind").toEqual([]);
  });

  test("a balance can never go negative, however the allocations are split", async ({ tenant }) => {
    const { partyId, invoice } = await invoiceFor(tenant, 10_000_00, 3);

    // Settle it fully, then try to settle it again.
    const ok = await recordPayment(tenant, {
      partyId, amountMinor: 11_800_00, paidOn: "2026-07-01",
      allocations: [{ document_id: invoice.documentId, amount_minor: 11_800_00 }],
    });
    expect(ok.ok()).toBeTruthy();
    expect(await balanceOf(tenant, invoice.documentId)).toBe(0);

    const again = await recordPayment(tenant, {
      partyId, amountMinor: 1_00, paidOn: "2026-07-02",
      allocations: [{ document_id: invoice.documentId, amount_minor: 1_00 }],
    });
    expect(again.ok()).toBeFalsy();
    expect(await balanceOf(tenant, invoice.documentId)).toBe(0);
  });

  test("money can be taken with nothing allocated, and stays visible as credit", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Paid In Advance Ltd", regionCode: "KA" });

    const res = await recordPayment(tenant, {
      partyId, amountMinor: 25_000_00, paidOn: "2026-07-01", allocations: [],
    });
    expect(res.ok()).toBeTruthy();

    const { data } = await tenant.db
      .from("payment_balances")
      .select("applied_minor, unapplied_minor");
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ applied_minor: 0, unapplied_minor: 25_000_00 });

    await tenant.page.goto("/payments");
    await expect(tenant.page.getByRole("cell", { name: "₹25,000.00" }).first()).toBeVisible();
  });
});
