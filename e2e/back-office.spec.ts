import { test, expect } from "./fixtures";
import { addParty, activityTypeId, recordActivity, issueInvoice, trip } from "./helpers/seed";

/**
 * Parties and settings — the screens that make the product usable without SQL.
 *
 * The parties tests care about one thing above the rest: the state code is
 * asked for under a split-rate regime and NOT under any other, because it is
 * the field that decides whether a sale is taxed as two components or one.
 * Asking for it where it means nothing is clutter; not asking for it where it
 * matters is a wrong invoice.
 */
test.describe("parties", () => {
  test("a customer can be added and corrected without leaving the page", async ({ tenant }) => {
    await tenant.page.goto("/parties");
    await expect(tenant.page.getByText("No customers yet")).toBeVisible();

    await tenant.page.getByRole("button", { name: "Add a party" }).click();
    await tenant.page.getByLabel("Name").fill("Godavari Polymers");
    await tenant.page.getByLabel("State code").fill("MH");
    await tenant.page.getByLabel("Payment terms").fill("20");
    await tenant.page.getByLabel("Address").fill("Gat 214, Chakan MIDC, Pune 410501");
    await tenant.page.getByRole("button", { name: "Add party" }).click();

    await expect(tenant.page.getByRole("cell", { name: "Godavari Polymers" })).toBeVisible();
    await expect(tenant.page.getByRole("cell", { name: "20d" })).toBeVisible();

    await tenant.page.getByRole("button", { name: "Edit" }).first().click();
    await tenant.page.getByLabel("Payment terms").fill("25");
    await tenant.page.getByRole("button", { name: "Save changes" }).click();
    await expect(tenant.page.getByRole("cell", { name: "25d" })).toBeVisible();
  });

  test("the state code is asked for only where it changes the tax", async ({ tenant, newTenant }) => {
    // Split-rate: the field decides two components or one.
    await tenant.page.goto("/parties");
    await tenant.page.getByRole("button", { name: "Add a party" }).click();
    await expect(tenant.page.getByLabel("State code")).toBeVisible();
    await expect(tenant.page.getByLabel("GSTIN")).toBeVisible();

    // Single-rate: it decides nothing, so it is not asked.
    const gb = await newTenant({ country: "GB", regionCode: null, templateKey: "generic" });
    await gb.page.goto("/parties");
    await gb.page.getByRole("button", { name: "Add a party" }).click();
    await expect(gb.page.getByLabel("State code")).toHaveCount(0);
    await expect(gb.page.getByLabel("VAT")).toBeVisible();
  });

  test("shows what each party still owes", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 100_000_00, occurredOn: "2026-06-12",
      details: trip("Bengaluru", "Hubballi"),
    });
    await issueInvoice(tenant, { partyId, activityIds: [activityId], docDate: "2026-06-30" });

    await tenant.page.goto("/parties");
    await expect(tenant.page.getByRole("cell", { name: "₹1,18,000.00" })).toBeVisible();
  });

  test("a duplicate tax identifier is refused with a readable reason", async ({ tenant }) => {
    await addParty(tenant, { name: "First", regionCode: "KA", taxId: "29AACCK9012L1Z5" });

    const res = await tenant.page.request.post("/api/parties", {
      data: { name: "Second", region_code: "KA", tax_id: "29AACCK9012L1Z5", payment_terms_days: 30 },
    });
    expect(res.status()).toBe(409);
    expect(await res.text()).toMatch(/tax identifier already exists/i);
  });
});

test.describe("settings", () => {
  test("describes the business in words rather than in jargon", async ({ tenant }) => {
    await tenant.page.goto("/settings");
    const body = tenant.page.locator("body");

    await expect(body).toContainText(tenant.orgName);
    await expect(body).toContainText("INR");
    await expect(body).toContainText("April");
    await expect(body).toContainText("One rate split in two");
    await expect(body).toContainText("18%");
  });

  test("shows the numbering rules, including that a debit note is ours to number", async ({ tenant }) => {
    await tenant.page.goto("/settings");

    // A bill is the supplier's document. A debit note is ours — we raise it
    // against a supplier to reduce what we owe. Getting that backwards made
    // debit notes impossible to issue at all, which is why it is asserted.
    const invoiceRow = tenant.page.getByRole("row", { name: /invoice/ });
    await expect(invoiceRow).toContainText("Numbered by you");

    const billRow = tenant.page.getByRole("row", { name: /^bill/ });
    await expect(billRow).toContainText("Numbered by the other party");

    const debitRow = tenant.page.getByRole("row", { name: /debit note/ });
    await expect(debitRow).toContainText("Numbered by you");
  });

  test("lists the fields this industry records, as the org's own", async ({ tenant, newTenant }) => {
    await tenant.page.goto("/settings");
    await expect(tenant.page.getByText("Trips")).toBeVisible();
    for (const field of ["Origin", "Destination", "Vehicle no.", "Load type"]) {
      await expect(tenant.page.getByText(field, { exact: true })).toBeVisible();
    }

    // Another business, configured differently, sees its own and not these.
    const other = await newTenant({ templateKey: "generic" });
    await other.page.goto("/settings");
    await expect(other.page.getByText("Services")).toBeVisible();
    await expect(other.page.getByText("Origin", { exact: true })).toHaveCount(0);
  });
});
