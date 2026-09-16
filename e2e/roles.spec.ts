import { test, expect, addStaffMember } from "./fixtures";
import { addParty, activityTypeId, recordActivity, issueInvoice, trip } from "./helpers/seed";

/**
 * What a member of staff may and may not do.
 *
 * `lib/auth/verify.ts` states the intent plainly: "issuing, cancelling,
 * exporting and closing a period are all owner-only actions." Two roles exist
 * in the schema and six migrations enforce one of them — and until now not one
 * test ran as anybody but an owner.
 *
 * The rule that matters here is that HIDING an action is not enforcing it. A
 * page that redirects a non-owner proves nothing about the route behind it,
 * and a member of staff who opens the network tab is not an attacker — they
 * are a curious colleague with a valid session.
 */
test.describe("roles", () => {
  test("a colleague can see the organisation's work and record more of it", async ({
    tenant, browser, baseURL,
  }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });

    const staff = await addStaffMember(browser, baseURL!, tenant);

    // Same organisation, so the same rows — this is not a tenancy boundary.
    await staff.page.goto("/activities");
    await expect(staff.page.getByRole("cell", { name: "Konkan Ceramics" })).toBeVisible();

    // Recording work is the everyday job, and is not owner-only.
    const res = await staff.page.request.post("/api/activities", {
      data: {
        activity_type_id: typeId,
        party_id: partyId,
        occurred_on: "2026-06-11",
        details: trip("C", "D"),
        amount_minor: 5_000_00,
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  });

  test("a colleague cannot cancel a document, at the route or the database", async ({
    tenant, browser, baseURL,
  }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });
    const invoice = await issueInvoice(tenant, {
      partyId, activityIds: [activityId], docDate: "2026-06-30",
    });

    const staff = await addStaffMember(browser, baseURL!, tenant);

    const viaRoute = await staff.page.request.post(`/api/documents/${invoice.documentId}/cancel`, {
      data: { reason: "Should not be allowed" },
    });
    expect(viaRoute.status()).toBe(403);

    // And again past the route entirely, because the RPC is granted to every
    // authenticated user and the route is not the only way to reach it.
    const { error } = await staff.db.rpc("cancel_document", {
      p_document_id: invoice.documentId,
      p_reason: "Should not be allowed",
    });
    expect(error, "the database must refuse this, not just the route").not.toBeNull();
    expect(error!.message).toMatch(/owner/i);

    const { data: doc } = await tenant.db
      .from("documents").select("status").eq("id", invoice.documentId).single();
    expect(doc!.status).toBe("issued");
  });

  test("a colleague cannot raise a credit note", async ({ tenant, browser, baseURL }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });
    const invoice = await issueInvoice(tenant, {
      partyId, activityIds: [activityId], docDate: "2026-06-30",
    });

    const staff = await addStaffMember(browser, baseURL!, tenant);

    const viaRoute = await staff.page.request.post(`/api/documents/${invoice.documentId}/credit-note`, {
      data: { taxable_value_minor: 1_000_00, reason: "Should not be allowed" },
    });
    expect(viaRoute.status()).toBe(403);

    const { error } = await staff.db.rpc("issue_credit_note", {
      p_document_id: invoice.documentId,
      p_taxable_value_minor: 1_000_00,
      p_total_minor: 1_180_00,
      p_reason: "Should not be allowed",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/owner/i);
  });

  test("a colleague cannot issue an invoice", async ({ tenant, browser, baseURL }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });

    const staff = await addStaffMember(browser, baseURL!, tenant);

    // The screen already says so: /documents/new sends a non-owner away.
    await staff.page.goto("/documents/new");
    await expect(staff.page).toHaveURL(/\/documents$/);

    // Which is where hiding stops and enforcing has to start.
    const res = await staff.page.request.post("/api/documents", {
      data: {
        doc_kind: "invoice",
        counterparty_id: partyId,
        doc_date: "2026-06-30",
        activity_ids: [activityId],
      },
    });
    expect(
      res.status(),
      "the page hides issuing from staff, so the route must refuse it too",
    ).toBe(403);

    const { data: docs } = await tenant.db.from("documents").select("id");
    expect(docs, "no document should exist").toEqual([]);
  });

  test("the document page offers a colleague no owner-only actions", async ({
    tenant, browser, baseURL,
  }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });
    const invoice = await issueInvoice(tenant, {
      partyId, activityIds: [activityId], docDate: "2026-06-30",
    });

    const staff = await addStaffMember(browser, baseURL!, tenant);
    await staff.page.goto(`/documents/${invoice.documentId}`);

    // They can read it — that is the job.
    await expect(staff.page.getByText(invoice.docNo)).toBeVisible();
    await expect(staff.page.getByRole("link", { name: "Open PDF" })).toBeVisible();

    // But none of the instruments are offered.
    await expect(staff.page.getByRole("button", { name: "Record a payment" })).toHaveCount(0);
    await expect(staff.page.getByRole("button", { name: "Cancel this invoice" })).toHaveCount(0);
    await expect(staff.page.getByRole("button", { name: "Raise a credit note" })).toHaveCount(0);
  });
});
