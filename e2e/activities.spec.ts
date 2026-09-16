import { test, expect } from "./fixtures";
import { addParty, activityTypeId } from "./helpers/seed";

/**
 * One form, many industries.
 *
 * ActivityForm has no fields of its own. It renders whatever the selected
 * activity type's `activity_fields` rows say, which is the mechanism the whole
 * product rests on — so these tests check the FORM CHANGES SHAPE between two
 * businesses configured differently, not merely that it submits.
 *
 * Validation is asserted at the API rather than only in the browser, because
 * it exists in two places on purpose: zod for messages, and a database trigger
 * for the write paths not written yet (CSV import, a support engineer in the
 * SQL console). The trigger is the one that must not be bypassable.
 */
test.describe("the activity form", () => {
  test("renders the fields a freight business configured", async ({ tenant }) => {
    await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    await tenant.page.goto("/activities");

    for (const label of ["Origin", "Destination", "Vehicle no.", "Load type"]) {
      await expect(tenant.page.getByLabel(label), `${label} should be on the form`).toBeVisible();
    }
    // A select renders its configured options and nothing else — plus a
    // placeholder, because this field is optional and "none" has to be
    // expressible. A required field's absence is caught by the trigger below.
    const options = await tenant.page.getByLabel("Load type").locator("option").allTextContents();
    expect(options).toEqual(["Select…", "Full truckload", "Part load", "Express"]);
  });

  test("renders completely different fields for a different industry", async ({ newTenant }) => {
    // The generic template ships one open service line and no extra fields.
    const consultancy = await newTenant({ templateKey: "generic", label: "Consultancy" });
    await addParty(consultancy, { name: "A Client" });
    await consultancy.page.goto("/activities");

    await expect(consultancy.page.getByLabel("Amount (INR)")).toBeVisible();
    for (const label of ["Origin", "Destination", "Vehicle no."]) {
      await expect(
        consultancy.page.getByLabel(label),
        `${label} belongs to freight and must not appear here`,
      ).toHaveCount(0);
    }
  });

  test("records a trip and shows it in the log", async ({ tenant }) => {
    await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    await tenant.page.goto("/activities");

    await tenant.page.getByLabel("Party").selectOption({ label: "Konkan Ceramics" });
    await tenant.page.getByLabel("Origin").fill("Dharwad");
    await tenant.page.getByLabel("Destination").fill("Belagavi");
    await tenant.page.getByLabel("Vehicle no.").fill("KA25AB4411");
    await tenant.page.getByLabel("Load type").selectOption("Full truckload");
    await tenant.page.getByLabel("Amount (INR)").fill("38000");
    await tenant.page.getByRole("button", { name: /Record/ }).click();

    await expect(tenant.page.getByRole("cell", { name: "Konkan Ceramics" })).toBeVisible();
    await expect(tenant.page.getByText("₹38,000.00")).toBeVisible();

    // Recorded as completed, which is what makes it billable.
    const { data } = await tenant.db.from("activities").select("status, details");
    expect(data).toHaveLength(1);
    expect(data![0].status).toBe("completed");
    expect(data![0].details).toMatchObject({ origin: "Dharwad", vehicle_no: "KA25AB4411" });
  });

  test("the database refuses bad details even when the API is bypassed", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");

    const cases: { why: string; details: Record<string, unknown>; expect: RegExp }[] = [
      {
        why: "a key no field defines",
        details: { origin: "A", destination: "B", smuggled: "x" },
        expect: /not a field|unknown/i,
      },
      {
        why: "a required field missing",
        details: { origin: "A" },
        expect: /required/i,
      },
      {
        why: "a value outside a select's options",
        details: { origin: "A", destination: "B", load_type: "Hovercraft" },
        expect: /not an option/i,
      },
      {
        why: "a number where text is expected",
        details: { origin: 42, destination: "B" },
        expect: /text|type/i,
      },
    ];

    for (const c of cases) {
      const { error } = await tenant.db.rpc("record_activity", {
        p_activity_type_id: typeId,
        p_party_id: partyId,
        p_occurred_on: "2026-06-12",
        p_amount_minor: 100_00,
        p_details: c.details as never,
        p_status: "completed",
      });
      expect(error, `${c.why} should have been refused`).not.toBeNull();
      expect(error!.message, `${c.why}: wrong reason`).toMatch(c.expect);
    }

    // Nothing got through.
    const { data } = await tenant.db.from("activities").select("id");
    expect(data).toEqual([]);
  });

  test("the form reports a validation failure rather than silently doing nothing", async ({ tenant }) => {
    await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    await tenant.page.goto("/activities");

    await tenant.page.getByLabel("Party").selectOption({ label: "Konkan Ceramics" });
    // Destination is required by this template and is left empty.
    await tenant.page.getByLabel("Origin").fill("Dharwad");
    await tenant.page.getByLabel("Amount (INR)").fill("1000");
    await tenant.page.getByRole("button", { name: /Record/ }).click();

    const { data } = await tenant.db.from("activities").select("id");
    expect(data, "an invalid activity must not be saved").toEqual([]);
  });
});
