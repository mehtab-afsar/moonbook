import { test, expect } from "./fixtures";
import { addParty, activityTypeId } from "./helpers/seed";
import { psql, lit } from "./helpers/psql";

/**
 * The three pricing strategies, priced through the running app.
 *
 * Both shipped templates use `manual`, so `flat` and `quantity_rate` had a
 * branch in lib/pricing, a preview in the form and a code path in the API, and
 * nothing had ever put a value through either. A closed set of three with one
 * member exercised is a closed set of one.
 *
 * The amount is computed on the SERVER on every path, never sent by the
 * browser — a client that could name its own amount on a quantity_rate type
 * could bill any figure it liked regardless of what was recorded. These tests
 * check that by sending a lie and watching it be ignored.
 */
async function pricedType(
  orgId: string,
  opts: { key: string; strategy: string; config: string; fields: [string, string, string][] },
) {
  const fieldRows = opts.fields
    .map(([k, label, type], i) => `(${lit(k)}, ${lit(label)}, ${lit(type)}, ${i})`)
    .join(",\n             ");

  psql(`
    insert into public.activity_types
      (org_id, key, label_singular, label_plural, direction, pricing_strategy, pricing_config, sort_order)
    values (${lit(orgId)}, ${lit(opts.key)}, 'Job', 'Jobs', 'receivable',
            ${lit(opts.strategy)}, ${lit(opts.config)}::jsonb, 20);

    insert into public.activity_fields
      (activity_type_id, org_id, key, label, field_type, options, is_required, is_reportable, show_on_document, sort_order)
    select t.id, ${lit(orgId)}, f.key, f.label, f.field_type, '[]'::jsonb, false, false, true, f.ord
      from public.activity_types t,
           (values ${fieldRows}) as f(key, label, field_type, ord)
     where t.org_id = ${lit(orgId)} and t.key = ${lit(opts.key)};
  `);
}

test.describe("pricing", () => {
  test("flat prices every record the same, with no amount field shown", async ({ tenant }) => {
    await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    await pricedType(tenant.orgId, {
      key: "inspection",
      strategy: "flat",
      config: '{"amount_minor": 250000}',
      fields: [["site", "Site", "text"]],
    });

    await tenant.page.goto("/activities");
    await tenant.page.getByLabel("What").selectOption({ label: "Job" });
    await tenant.page.getByLabel("Party").selectOption({ label: "Konkan Ceramics" });

    // A flat type has nothing to type: the price is the type's, not the row's.
    await expect(tenant.page.getByLabel("Amount (INR)")).toHaveCount(0);
    await expect(tenant.page.getByText("₹2,500.00")).toBeVisible();

    await tenant.page.getByLabel("Site").fill("Peenya yard");
    await tenant.page.getByRole("button", { name: /Record/ }).click();

    await expect(tenant.page.getByRole("cell", { name: "₹2,500.00" })).toBeVisible();
    const { data } = await tenant.db.from("activities").select("amount_minor");
    expect(data![0].amount_minor).toBe(250000);
  });

  test("quantity_rate multiplies two recorded fields, and previews it", async ({ tenant }) => {
    await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    await pricedType(tenant.orgId, {
      key: "haulage",
      strategy: "quantity_rate",
      config: '{"quantity_field": "tonnes", "rate_minor": 120000}',
      fields: [["tonnes", "Tonnes", "number"]],
    });

    await tenant.page.goto("/activities");
    await tenant.page.getByLabel("What").selectOption({ label: "Job" });
    await tenant.page.getByLabel("Party").selectOption({ label: "Konkan Ceramics" });
    await tenant.page.getByLabel("Tonnes").fill("3.5");

    // 3.5 × ₹1,200.00 = ₹4,200.00, shown before saving so the figure is never
    // a surprise, and explained so it is never unaccountable.
    await expect(tenant.page.getByText("₹4,200.00")).toBeVisible();

    await tenant.page.getByRole("button", { name: /Record/ }).click();
    await expect(tenant.page.getByRole("cell", { name: "₹4,200.00" })).toBeVisible();

    const { data } = await tenant.db.from("activities").select("amount_minor, details");
    expect(data![0].amount_minor).toBe(420000);
    expect(data![0].details).toEqual({ tonnes: 3.5 });
  });

  test("the server prices it, whatever the browser claims", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    await pricedType(tenant.orgId, {
      key: "haulage2",
      strategy: "quantity_rate",
      config: '{"quantity_field": "tonnes", "rate_minor": 120000}',
      fields: [["tonnes", "Tonnes", "number"]],
    });
    const { data: type } = await tenant.db
      .from("activity_types").select("id").eq("key", "haulage2").single();

    // A crafted request naming its own, much smaller, amount.
    const res = await tenant.page.request.post("/api/activities", {
      data: {
        activity_type_id: type!.id,
        party_id: partyId,
        occurred_on: "2026-06-12",
        details: { tonnes: 3.5 },
        amount_minor: 1,
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    const { data } = await tenant.db.from("activities").select("amount_minor");
    expect(
      data![0].amount_minor,
      "the claimed amount must be ignored on a computed strategy",
    ).toBe(420000);
  });

  test("a quantity_rate type refuses to price a record missing its quantity", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    await pricedType(tenant.orgId, {
      key: "haulage3",
      strategy: "quantity_rate",
      config: '{"quantity_field": "tonnes", "rate_minor": 120000}',
      fields: [["tonnes", "Tonnes", "number"]],
    });
    const { data: type } = await tenant.db
      .from("activity_types").select("id").eq("key", "haulage3").single();

    const res = await tenant.page.request.post("/api/activities", {
      data: {
        activity_type_id: type!.id,
        party_id: partyId,
        occurred_on: "2026-06-12",
        details: {},
      },
    });
    // Refused rather than priced at zero. A silent zero is an invoice for
    // nothing, which nobody notices until the month-end total is short.
    expect(res.status()).toBe(422);
    expect(await res.text()).toMatch(/tonnes|quantity/i);

    const { data } = await tenant.db.from("activities").select("id");
    expect(data).toEqual([]);
  });

  test("manual still requires a figure to be typed", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    // Via the helper, which filters out the system template — `key` alone
    // matches both the shared row and this org's copy of it.
    const typeId = await activityTypeId(tenant, "trip");

    const res = await tenant.page.request.post("/api/activities", {
      data: {
        activity_type_id: typeId,
        party_id: partyId,
        occurred_on: "2026-06-12",
        details: { origin: "A", destination: "B" },
      },
    });
    expect(res.status()).toBe(422);
    expect(await res.text()).toMatch(/amount/i);
  });
});
