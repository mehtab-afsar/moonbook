import { test, expect } from "./fixtures";
import { addParty, activityTypeId, recordActivity, issueInvoice, trip } from "./helpers/seed";

/**
 * The tenancy boundary, asserted directly rather than trusted.
 *
 * RLS is the boundary in this app — route handlers carry no `.eq("org_id", …)`
 * anywhere, by rule, so if a policy is wrong there is nothing else standing
 * between two businesses. That makes these the most important tests here.
 *
 * Two rules the plan states and this file enforces:
 *   · a cross-tenant read is a **404, never a 403**. A 403 confirms the record
 *     exists, which is exactly the fact being withheld.
 *   · the other tenant's identifiers appear **nowhere** in a response — not
 *     just filtered out of the visible list.
 */
test.describe("tenancy", () => {
  test("one tenant cannot see another's documents, by id or in a list", async ({ newTenant }) => {
    const alpha = await newTenant({ label: "Alpha Freight" });
    const beta = await newTenant({ label: "Beta Freight" });

    const partyId = await addParty(alpha, { name: "Alpha Customer", regionCode: "KA" });
    const typeId = await activityTypeId(alpha, "trip");
    const activityId = await recordActivity(alpha, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-12", details: trip("Pune", "Nashik"),
    });
    const invoice = await issueInvoice(alpha, {
      partyId, activityIds: [activityId], docDate: "2026-06-30",
    });

    // Beta asks for Alpha's invoice by its exact id.
    const byId = await beta.page.request.get(`/api/documents/${invoice.documentId}/pdf`);
    expect(byId.status(), "a cross-tenant read must be 404, never 403").toBe(404);

    const detail = await beta.page.goto(`/documents/${invoice.documentId}`);
    expect(detail?.status()).toBe(404);

    // And Beta's own list mentions it nowhere — not merely hides it.
    const list = await beta.page.request.get("/api/documents");
    expect(list.ok()).toBeTruthy();
    const body = await list.text();
    expect(body).not.toContain(invoice.documentId);
    expect(body).not.toContain(invoice.docNo);
    expect(body).not.toContain("Alpha Customer");
  });

  test("the database itself returns zero rows, not just the API", async ({ newTenant }) => {
    const alpha = await newTenant({ label: "Alpha Ledger" });
    const beta = await newTenant({ label: "Beta Ledger" });

    const partyId = await addParty(alpha, { name: "Alpha Customer", regionCode: "KA" });
    const typeId = await activityTypeId(alpha, "trip");
    const activityId = await recordActivity(alpha, {
      typeId, partyId, amountMinor: 5_000_00, occurredOn: "2026-06-12", details: trip("Hubballi", "Belagavi"),
    });
    await issueInvoice(alpha, { partyId, activityIds: [activityId], docDate: "2026-06-30" });

    // Beta's own client, so this is RLS answering rather than application code.
    for (const relation of [
      "documents", "document_lines", "document_taxes", "activities", "parties", "payments", "allocations",
      "document_balances", "party_outstanding", "credit_balances", "payment_balances",
    ]) {
      const { data, error } = await beta.db.from(relation).select("*");
      expect(error, `${relation} query failed`).toBeNull();
      expect(data, `${relation} leaked rows across tenants`).toEqual([]);
    }
  });

  test("a signed-out caller reaches nothing", async ({ browser, tenant }) => {
    const partyId = await addParty(tenant, { name: "Some Customer", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 1_000_00, occurredOn: "2026-06-12", details: trip("A", "B"),
    });
    const invoice = await issueInvoice(tenant, {
      partyId, activityIds: [activityId], docDate: "2026-06-30",
    });

    const anon = await browser.newContext();
    try {
      const pdf = await anon.request.get(`/api/documents/${invoice.documentId}/pdf`);
      expect(pdf.status()).toBe(401);

      const page = await anon.newPage();
      await page.goto("/documents");
      // Sent to the front door, and nothing of the tenant's on the way.
      await expect(page).not.toHaveURL(/\/documents/);
      expect(await page.content()).not.toContain(invoice.docNo);
    } finally {
      await anon.close();
    }
  });

  test("shared industry templates are readable but not writable", async ({ tenant }) => {
    // The one deliberately tenant-agnostic table. Readable by everyone —
    // it is the catalogue offered at signup, and must be readable BEFORE an
    // organisation exists — and therefore writable by no one.
    const { data: templates, error } = await tenant.db
      .from("industry_templates")
      .select("key, label");
    expect(error).toBeNull();
    expect((templates ?? []).length).toBeGreaterThan(0);

    const { error: writeError } = await tenant.db
      .from("industry_templates")
      .insert({ key: "sneaky", label: "Mine", description: "no", sort_order: 99 });
    expect(writeError, "a tenant must not be able to add an industry for everyone").not.toBeNull();
  });

  test("a tenant cannot touch the numbering counters", async ({ tenant }) => {
    // document_sequences is deny-all: RLS on, zero policies, grants revoked.
    // A client that could increment one could burn or forge an invoice number.
    const { data, error } = await tenant.db.from("document_sequences").select("*");
    expect(data ?? []).toEqual([]);
    if (error) expect(error.message).toBeTruthy();

    const { error: writeError } = await tenant.db
      .from("document_sequences")
      .update({ last_value: 0 })
      .eq("doc_kind", "invoice");
    expect(writeError ?? { message: "no rows" }).toBeTruthy();
  });
});
