import { test, expect } from "./fixtures";
import {
  addParty, activityTypeId, recordActivity, issueInvoice, recordPayment,
  balanceOf, documentTaxes, trip,
} from "./helpers/seed";

/**
 * Putting things right after they have gone wrong.
 *
 * Every path here existed in the database and was unreachable from the app: a
 * recorded activity could not be corrected, an invoice could not be cancelled,
 * money taken on account could never be spent, and a credit note could not be
 * raised at all. The ledger was ahead of the product, which is a comfortable
 * place to be until a customer mistypes an amount.
 *
 * The ordering of what each instrument refuses is the substance of these
 * tests: cancel is for a document nothing has been applied to, a credit note
 * is for one that has taken money, and neither may be used for the other's
 * job.
 */
test.describe("corrections", () => {
  test("a mistyped amount can be corrected before it is billed", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 38_000_00, occurredOn: "2026-06-10",
      details: trip("Dharwad", "Belagavi", "KA25AB4411"),
    });

    const res = await tenant.page.request.patch(`/api/activities/${activityId}`, {
      data: {
        party_id: partyId,
        occurred_on: "2026-06-10",
        amount_minor: 3_800_00,
        details: trip("Dharwad", "Belagavi", "KA25AB4411"),
        status: "completed",
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    const { data } = await tenant.db.from("activities").select("amount_minor, status");
    expect(data![0]).toMatchObject({ amount_minor: 3_800_00, status: "completed" });

    // And the correction is on the record, with what it was before.
    const { data: events } = await tenant.db
      .from("audit_events").select("action, before, after").eq("action", "activity.updated");
    expect(events).toHaveLength(1);
    expect(events![0].before.amount_minor).toBe(38_000_00);
    expect(events![0].after.amount_minor).toBe(3_800_00);
  });

  test("a correction is still validated against the industry's own fields", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10",
      details: trip("A", "B"),
    });

    const res = await tenant.page.request.patch(`/api/activities/${activityId}`, {
      data: {
        party_id: partyId, occurred_on: "2026-06-10", amount_minor: 10_000_00,
        details: { origin: "A", destination: "B", load_type: "Hovercraft" },
        status: "completed",
      },
    });
    expect(res.status()).toBe(422);
    // The message names the field and lists what it accepts — the zod layer's
    // job, alongside the trigger that enforces the same rule structurally.
    expect(await res.text()).toMatch(/Load type must be one of: Full truckload, Part load, Express/);
  });

  test("work that has been invoiced cannot be quietly edited", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });
    await issueInvoice(tenant, { partyId, activityIds: [activityId], docDate: "2026-06-30" });

    const res = await tenant.page.request.patch(`/api/activities/${activityId}`, {
      data: {
        party_id: partyId, occurred_on: "2026-06-10", amount_minor: 1_00,
        details: trip("A", "B"), status: "completed",
      },
    });
    expect(res.status()).toBe(409);
    expect(await res.text()).toMatch(/already been invoiced/i);

    // The invoice and the work still agree.
    const { data } = await tenant.db.from("activities").select("amount_minor");
    expect(data![0].amount_minor).toBe(10_000_00);
  });

  test("an invoice with nothing applied can be cancelled and the work re-billed", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });
    const first = await issueInvoice(tenant, {
      partyId, activityIds: [activityId], docDate: "2026-06-30",
    });

    const res = await tenant.page.request.post(`/api/documents/${first.documentId}/cancel`, {
      data: { reason: "Raised against the wrong customer" },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    // Gone from what is owed.
    const { data: outstanding } = await tenant.db
      .from("party_outstanding").select("amount_outstanding_minor").eq("party_id", partyId);
    expect((outstanding ?? []).reduce((n, r) => n + (r.amount_outstanding_minor ?? 0), 0)).toBe(0);

    // And genuinely re-billable, not reopened in name only.
    const second = await issueInvoice(tenant, {
      partyId, activityIds: [activityId], docDate: "2026-06-30",
    });
    expect(second.documentId).not.toBe(first.documentId);
    expect(second.totalMinor).toBe(11_800_00);
  });

  test("an invoice that has taken money cannot be cancelled", async ({ tenant }) => {
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

    const res = await tenant.page.request.post(`/api/documents/${invoice.documentId}/cancel`, {
      data: { reason: "Changed my mind" },
    });
    expect(res.ok()).toBeFalsy();
    // The refusal names the alternative rather than just saying no.
    expect(await res.text()).toMatch(/credit note|applied|received/i);

    expect(await balanceOf(tenant, invoice.documentId)).toBe(6_800_00);
  });

  test("a credit note is the instrument for an invoice that has been paid against", async ({ tenant }) => {
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

    // Credit 2,000 of taxable value; tax follows the invoice's own treatment.
    const res = await tenant.page.request.post(`/api/documents/${invoice.documentId}/credit-note`, {
      data: { taxable_value_minor: 2_000_00, reason: "Overcharged on the return leg" },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();

    expect(body.data.total_minor).toBe(2_360_00);
    expect(body.data.doc_no).toMatch(/^CN-/);
    expect(body.data.applied_minor).toBe(2_360_00);

    // It carries the same tax shape the invoice did — two components, not one.
    const noteTaxes = await documentTaxes(tenant, body.data.document_id);
    expect(noteTaxes.map((t) => t.component_code)).toEqual(["CGST", "SGST"]);

    // 11,800 − 5,000 paid − 2,360 credited.
    expect(await balanceOf(tenant, invoice.documentId)).toBe(4_440_00);
  });

  test("a credit note cannot exceed what was billed, but may exceed what is left", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });
    const invoice = await issueInvoice(tenant, {
      partyId, activityIds: [activityId], docDate: "2026-06-30",
    });

    // More than was ever billed is not a correction.
    const tooBig = await tenant.page.request.post(`/api/documents/${invoice.documentId}/credit-note`, {
      data: { taxable_value_minor: 50_000_00, reason: "Too much" },
    });
    expect(tooBig.ok()).toBeFalsy();
    expect(await tooBig.text()).toMatch(/more than/i);

    // Settle it in full, then credit anyway — the excess is real credit.
    await recordPayment(tenant, {
      partyId, amountMinor: 11_800_00, paidOn: "2026-07-01",
      allocations: [{ document_id: invoice.documentId, amount_minor: 11_800_00 }],
    });
    expect(await balanceOf(tenant, invoice.documentId)).toBe(0);

    const res = await tenant.page.request.post(`/api/documents/${invoice.documentId}/credit-note`, {
      data: { taxable_value_minor: 2_000_00, reason: "Goodwill after the fact" },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();

    // Nothing left to apply it to, so it stays as credit rather than being forced.
    expect(body.data.applied_minor).toBe(0);
    const { data: credit } = await tenant.db
      .from("credit_balances").select("unapplied_minor").eq("document_id", body.data.document_id);
    expect(credit![0].unapplied_minor).toBe(2_360_00);
  });

  test("money taken on account can be applied to a later invoice", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Pays In Advance Ltd", regionCode: "KA" });

    // Paid before anything was billed — unallocated, on account.
    const paid = await recordPayment(tenant, {
      partyId, amountMinor: 20_000_00, paidOn: "2026-06-01", allocations: [],
    });
    expect(paid.ok()).toBeTruthy();
    const { data: payments } = await tenant.db.from("payment_balances").select("payment_id, unapplied_minor");
    expect(payments![0].unapplied_minor).toBe(20_000_00);

    // The invoice arrives later.
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });
    const invoice = await issueInvoice(tenant, {
      partyId, activityIds: [activityId], docDate: "2026-06-30",
    });

    const res = await tenant.page.request.post("/api/allocations", {
      data: {
        target_document_id: invoice.documentId,
        amount_minor: 11_800_00,
        payment_id: payments![0].payment_id,
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    expect(await balanceOf(tenant, invoice.documentId)).toBe(0);
    const { data: after } = await tenant.db.from("payment_balances").select("unapplied_minor");
    expect(after![0].unapplied_minor).toBe(8_200_00);
  });

  test("applying more than is owed, or more than is held, is refused", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });
    const invoice = await issueInvoice(tenant, {
      partyId, activityIds: [activityId], docDate: "2026-06-30",
    });
    await recordPayment(tenant, { partyId, amountMinor: 5_000_00, paidOn: "2026-07-01", allocations: [] });
    const { data: payments } = await tenant.db.from("payment_balances").select("payment_id");

    // More than the payment holds.
    const overPayment = await tenant.page.request.post("/api/allocations", {
      data: {
        target_document_id: invoice.documentId, amount_minor: 9_000_00,
        payment_id: payments![0].payment_id,
      },
    });
    expect(overPayment.ok()).toBeFalsy();
    expect(await overPayment.text()).toMatch(/unapplied/i);

    // Neither source at all.
    const noSource = await tenant.page.request.post("/api/allocations", {
      data: { target_document_id: invoice.documentId, amount_minor: 1_00 },
    });
    expect(noSource.status()).toBe(422);

    expect(await balanceOf(tenant, invoice.documentId)).toBe(11_800_00);
  });
});
