import { test, expect } from "./fixtures";
import { addParty } from "./helpers/seed";
import { psql, lit } from "./helpers/psql";

/**
 * All six field types, through the form that renders them.
 *
 * The plan chose six deliberately — "six field types, not eleven", because
 * each costs five surfaces: a form widget, a zod branch, a PDF renderer, a
 * filter control and a trigger branch. Both shipped templates use three of
 * them: text, long_text and select. So `number`, `date` and `boolean` have a
 * widget, a validator, a trigger branch and a renderer each, and until now
 * nothing had ever put a value through any of them.
 *
 * A type system with untested members is a list of promises.
 */

/** An activity type exercising every field type, added as an operator would. */
async function everyFieldType(tenant: { orgId: string }) {
  const key = `kitchen_sink_${Date.now().toString(36)}`;
  psql(`
    insert into public.activity_types
      (org_id, key, label_singular, label_plural, direction, pricing_strategy, sort_order)
    values (${lit(tenant.orgId)}, ${lit(key)}, 'Job', 'Jobs', 'receivable', 'manual', 10);

    insert into public.activity_fields
      (activity_type_id, org_id, key, label, field_type, options, is_required, is_reportable, show_on_document, sort_order)
    select t.id, ${lit(tenant.orgId)}, f.key, f.label, f.field_type, f.options::jsonb, f.req, false, true, f.ord
      from public.activity_types t,
           (values
             ('site_name',   'Site name',   'text',      '[]',              true,  0),
             ('site_notes',  'Site notes',  'long_text', '[]',              false, 1),
             ('headcount',   'Headcount',   'number',    '[]',              true,  2),
             ('visited_on',  'Visited on',  'date',      '[]',              false, 3),
             ('shift',       'Shift',       'select',    '["Day","Night"]', false, 4),
             ('needs_crane', 'Needs crane', 'boolean',   '[]',              false, 5)
           ) as f(key, label, field_type, options, req, ord)
     where t.org_id = ${lit(tenant.orgId)} and t.key = ${lit(key)};
  `);
  return key;
}

test.describe("field types", () => {
  test("the form renders a suitable control for each of the six", async ({ tenant }) => {
    await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    await everyFieldType(tenant);
    await tenant.page.goto("/activities");
    await tenant.page.getByLabel("What").selectOption({ label: "Job" });

    // A number gets a numeric input, not a text box that happens to hold digits.
    await expect(tenant.page.getByLabel("Headcount")).toHaveAttribute("type", "number");
    await expect(tenant.page.getByLabel("Visited on")).toHaveAttribute("type", "date");
    await expect(tenant.page.getByLabel("Needs crane")).toHaveAttribute("type", "checkbox");
    await expect(tenant.page.getByLabel("Site notes")).toHaveJSProperty("tagName", "TEXTAREA");
    await expect(tenant.page.getByLabel("Shift").locator("option")).toHaveCount(3); // + placeholder
    await expect(tenant.page.getByLabel("Site name")).toBeVisible();
  });

  test("every type round-trips its value with the right JSON shape", async ({ tenant }) => {
    await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    await everyFieldType(tenant);
    await tenant.page.goto("/activities");

    await tenant.page.getByLabel("What").selectOption({ label: "Job" });
    await tenant.page.getByLabel("Party").selectOption({ label: "Konkan Ceramics" });
    await tenant.page.getByLabel("Site name").fill("Peenya yard");
    await tenant.page.getByLabel("Site notes").fill("Two gates,\nsecond one locked after six");
    await tenant.page.getByLabel("Headcount").fill("7");
    await tenant.page.getByLabel("Visited on").fill("2026-06-12");
    await tenant.page.getByLabel("Shift").selectOption("Night");
    await tenant.page.getByLabel("Needs crane").check();
    await tenant.page.getByLabel("Amount (INR)").fill("4200");
    await tenant.page.getByRole("button", { name: /Record/ }).click();

    await expect(tenant.page.getByRole("cell", { name: "₹4,200.00" })).toBeVisible();

    const { data } = await tenant.db.from("activities").select("details");
    // The types matter as much as the values: the trigger checks jsonb_typeof
    // against field_type, so a number stored as "7" would be rejected on the
    // next write and silently mis-sort in any report before then.
    expect(data![0].details).toEqual({
      site_name: "Peenya yard",
      site_notes: "Two gates,\nsecond one locked after six",
      headcount: 7,
      visited_on: "2026-06-12",
      shift: "Night",
      needs_crane: true,
    });
    expect(typeof (data![0].details as Record<string, unknown>).headcount).toBe("number");
    expect(typeof (data![0].details as Record<string, unknown>).needs_crane).toBe("boolean");
  });

  test("an unticked boolean and an untouched optional field are simply absent", async ({ tenant }) => {
    await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    await everyFieldType(tenant);
    await tenant.page.goto("/activities");

    await tenant.page.getByLabel("What").selectOption({ label: "Job" });
    await tenant.page.getByLabel("Party").selectOption({ label: "Konkan Ceramics" });
    await tenant.page.getByLabel("Site name").fill("Peenya yard");
    await tenant.page.getByLabel("Headcount").fill("3");
    await tenant.page.getByLabel("Amount (INR)").fill("1000");
    await tenant.page.getByRole("button", { name: /Record/ }).click();

    await expect(tenant.page.getByRole("cell", { name: "₹1,000.00" })).toBeVisible();

    const { data } = await tenant.db.from("activities").select("details");
    // Not `false`, not `""`, not null — absent. An optional field that was
    // never answered has no answer, and storing one invents data.
    expect(data![0].details).toEqual({ site_name: "Peenya yard", headcount: 3 });
  });

  test("the database refuses a value of the wrong JSON type", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const key = await everyFieldType(tenant);
    const { data: type } = await tenant.db
      .from("activity_types").select("id").eq("key", key).single();

    // The expected text is the message a person would read, not a code. The
    // trigger names the FIELD LABEL and what it got, which is what makes a
    // bulk import failure diagnosable rather than merely refused.
    const cases: { why: string; details: Record<string, unknown>; expect: RegExp }[] = [
      { why: "a string in a number field",
        details: { site_name: "x", headcount: "seven" },
        expect: /Headcount must be a number, got string/ },
      { why: "a number in a boolean field",
        details: { site_name: "x", headcount: 1, needs_crane: 1 },
        expect: /Needs crane must be true or false, got number/ },
      { why: "a nonsense date",
        details: { site_name: "x", headcount: 1, visited_on: "the twelfth" },
        expect: /Visited on must be a date/ },
    ];

    for (const c of cases) {
      const { error } = await tenant.db.rpc("record_activity", {
        p_activity_type_id: type!.id,
        p_party_id: partyId,
        p_occurred_on: "2026-06-12",
        p_amount_minor: 100_00,
        p_details: c.details as never,
        p_status: "completed",
      });
      expect(error, `${c.why} should have been refused`).not.toBeNull();
      expect(error!.message, `${c.why}: wrong reason`).toMatch(c.expect);
    }

    const { data } = await tenant.db.from("activities").select("id");
    expect(data).toEqual([]);
  });

  test("every printed field reaches the invoice, whatever its type", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const key = await everyFieldType(tenant);
    const { data: type } = await tenant.db
      .from("activity_types").select("id").eq("key", key).single();

    const { data: act } = await tenant.db.rpc("record_activity", {
      p_activity_type_id: type!.id,
      p_party_id: partyId,
      p_occurred_on: "2026-06-12",
      p_amount_minor: 4_200_00,
      p_details: {
        site_name: "Peenya yard", headcount: 7,
        visited_on: "2026-06-12", shift: "Night", needs_crane: true,
      } as never,
      p_status: "completed",
    }).single<{ activity_id: string }>();

    const res = await tenant.page.request.post("/api/documents", {
      data: {
        doc_kind: "invoice", counterparty_id: partyId,
        doc_date: "2026-06-30", activity_ids: [act!.activity_id],
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const { data: body } = await res.json();

    const { data: doc } = await tenant.db
      .from("documents").select("issued_snapshot").eq("id", body.document_id).single();

    // Frozen as rendered TEXT — a boolean prints as "true", a number as "7".
    // Every type has to survive `details->>key`, which is where a jsonb value
    // stops being typed and becomes something a person reads.
    const printed = doc!.issued_snapshot.lines[0].printable_details as
      { label: string; value: string }[];
    expect(Object.fromEntries(printed.map((d) => [d.label, d.value]))).toEqual({
      "Site name": "Peenya yard",
      Headcount: "7",
      "Visited on": "2026-06-12",
      Shift: "Night",
      "Needs crane": "true",
    });

    // And the PDF renders with them.
    const pdf = await tenant.page.request.get(`/api/documents/${body.document_id}/pdf`);
    expect(pdf.ok()).toBeTruthy();
    expect(Buffer.from(await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
