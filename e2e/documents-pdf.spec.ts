import { test, expect } from "./fixtures";
import { addParty, activityTypeId, recordActivity, issueInvoice, trip } from "./helpers/seed";
import { psql, lit } from "./helpers/psql";

/**
 * The PDF, and the promise that an issued document does not change.
 *
 * Everything the renderer needs is frozen into `issued_snapshot` at the moment
 * of issue. The tests below break that promise on purpose — renaming a field,
 * renaming the business, correcting a customer's address — and check the
 * document already sent is unmoved. An invoice is a statement of fact made on
 * a date, and a tax authority holds a copy.
 */
async function anIssuedInvoice(tenant: Parameters<typeof addParty>[0]) {
  const partyId = await addParty(tenant, {
    name: "Konkan Ceramics", regionCode: "KA",
    address: "Plot 9, Peenya Industrial Area, Bengaluru 560058",
  });
  const typeId = await activityTypeId(tenant, "trip");
  const activityId = await recordActivity(tenant, {
    typeId, partyId, amountMinor: 100_000_00, occurredOn: "2026-06-12",
    details: trip("Bengaluru", "Hubballi", "KA01AB1234"),
  });
  const invoice = await issueInvoice(tenant, {
    partyId, activityIds: [activityId], docDate: "2026-06-30",
  });
  return { partyId, invoice };
}

test.describe("documents and PDFs", () => {
  test("serves a real PDF, named after the document", async ({ tenant }) => {
    const { invoice } = await anIssuedInvoice(tenant);

    const res = await tenant.page.request.get(`/api/documents/${invoice.documentId}/pdf`);
    expect(res.ok()).toBeTruthy();
    expect(res.headers()["content-type"]).toContain("application/pdf");
    expect(res.headers()["content-disposition"]).toContain(`${invoice.docNo}.pdf`);

    // It must never sit in a shared cache: it names a customer and an amount.
    expect(res.headers()["cache-control"]).toContain("private");

    const body = Buffer.from(await res.body());
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(body.length).toBeGreaterThan(3000);
  });

  test("the PDF link on the document page works", async ({ tenant }) => {
    const { invoice } = await anIssuedInvoice(tenant);
    await tenant.page.goto(`/documents/${invoice.documentId}`);

    const link = tenant.page.getByRole("link", { name: "Open PDF" });
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    expect(href).toBe(`/api/documents/${invoice.documentId}/pdf`);

    const res = await tenant.page.request.get(href!);
    expect(res.ok()).toBeTruthy();
  });

  test("renaming a field does not reword an invoice already sent", async ({ tenant }) => {
    const { invoice } = await anIssuedInvoice(tenant);

    const before = await tenant.db
      .from("documents").select("issued_snapshot").eq("id", invoice.documentId).single();
    const beforeLabels = before.data!.issued_snapshot.lines[0].printable_details
      .map((d: { label: string }) => d.label);
    expect(beforeLabels).toEqual(["Origin", "Destination", "Vehicle no.", "Load type"]);

    // Reconfigure the business, as a customer is entitled to.
    await tenant.db.from("activity_fields")
      .update({ label: "Starting point" }).not("org_id", "is", null).eq("key", "origin");
    await tenant.db.from("organisations")
      .update({ legal_name: "Renamed Since" }).eq("id", tenant.orgId);

    const after = await tenant.db
      .from("documents").select("issued_snapshot").eq("id", invoice.documentId).single();
    expect(after.data!.issued_snapshot.lines[0].printable_details[0].label).toBe("Origin");
    expect(after.data!.issued_snapshot.organisation.legal_name).toBe(tenant.orgName);

    // And the rendered document is unmoved too, not merely the stored copy.
    await tenant.page.goto(`/documents/${invoice.documentId}`);
    await expect(tenant.page.getByText("Origin: Bengaluru", { exact: false })).toBeVisible();
    await expect(tenant.page.getByText("Starting point", { exact: false })).toHaveCount(0);
  });

  test("correcting a customer's address does not rewrite their old invoices", async ({ tenant }) => {
    const { partyId, invoice } = await anIssuedInvoice(tenant);

    await tenant.page.request.patch(`/api/parties/${partyId}`, {
      data: { address: "A completely different address", name: "Konkan Ceramics Pvt Ltd" },
    });

    const { data } = await tenant.db
      .from("documents").select("issued_snapshot").eq("id", invoice.documentId).single();
    expect(data!.issued_snapshot.counterparty.name).toBe("Konkan Ceramics");
    expect(data!.issued_snapshot.counterparty.address).toContain("Peenya Industrial Area");
  });

  test("a document with no snapshot has no PDF, and says so", async ({ tenant }) => {
    const { partyId, invoice } = await anIssuedInvoice(tenant);

    // Force the state a draft would be in.
    //
    // Two reasons this goes through psql. First, `documents` is select-only to
    // every client role — all writes go through RPCs — so the tenant's own
    // client cannot make this state, and a PostgREST update matching no rows
    // answers 200, which would have made a broken setup look fine.
    //
    // Second, drafts are unreachable through the product today: issue_document
    // always snapshots. This guard is defence for the draft feature that does
    // not exist yet, so the state has to be built by hand to test it at all.
    psql(
      `update public.documents
          set status = 'draft', issued_snapshot = null
        where id = ${lit(invoice.documentId)}`,
    );

    const res = await tenant.page.request.get(`/api/documents/${invoice.documentId}/pdf`);
    expect(res.status()).toBe(409);
    expect(await res.text()).toMatch(/not been issued/i);

    await tenant.page.goto(`/documents/${invoice.documentId}`);
    await expect(tenant.page.getByText("has not been issued yet")).toBeVisible();
    await expect(tenant.page.getByRole("link", { name: "Open PDF" })).toHaveCount(0);
    void partyId;
  });

  test("a document that does not exist is a 404", async ({ tenant }) => {
    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await tenant.page.request.get(`/api/documents/${missing}/pdf`)).status()).toBe(404);
    expect((await tenant.page.goto(`/documents/${missing}`))?.status()).toBe(404);
  });
});
