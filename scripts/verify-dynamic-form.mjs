/**
 * The architecture's headline claim, checked in a browser:
 * ONE form component renders two genuinely different industries, because it
 * has no fields of its own and reads them from configuration.
 *
 *   npm run dev   (in another terminal)
 *   npx supabase db reset && node scripts/verify-dynamic-form.mjs
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const APP = "http://localhost:3000";
const MAILPIT = "http://127.0.0.1:56324";
const STAMP = Date.now();
const EMAIL = `form-${STAMP}@moonbook.test`;
const ORG_NAME = `Two Industries ${STAMP}`;

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const results = [];
const check = (label, ok, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n      ${detail}`}`);
};

async function signInLink(email) {
  for (let i = 0; i < 30; i++) {
    const b = await fetch(`${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(email)}&limit=1`).then((r) => r.json());
    if (b.messages?.length) {
      const m = await fetch(`${MAILPIT}/api/v1/message/${b.messages[0].ID}`).then((r) => r.json());
      const x = m.Text.match(/http:\/\/127\.0\.0\.1:56321\/auth\/v1\/verify\?[^\s)]+/);
      if (x) return x[0];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("no sign-in email");
}

const fieldRow = (typeId, orgId, over) => ({
  activity_type_id: typeId, org_id: orgId,
  options: [], is_required: false, is_reportable: false, show_on_document: true,
  ...over,
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });

// Keep the last save response so a failure says WHY, not just "nothing here".
let lastPost = null;
page.on("response", async (r) => {
  if (r.url().includes("/api/activities") && r.request().method() === "POST") {
    lastPost = `${r.status()} ${await r.text().catch(() => "")}`;
  }
});

try {
  console.log("\nMoonbook — one form, two industries\n");

  // Sign up and set up through the real UI.
  await page.goto(`${APP}/start`);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByRole("button", { name: "Send me a sign-in link" }).click();
  await page.getByText("Check your email.").waitFor();
  await page.goto(await signInLink(EMAIL));
  await page.waitForURL(`${APP}/start`);
  await page.getByLabel("Business name").fill(ORG_NAME);
  // Pick the generic template: since Phase 3 signup applies one automatically,
  // and this script defines its own two types, generic is the one whose keys
  // don't collide with them.
  await page.getByText("Something else").click();
  await page.selectOption("#country", "IN");
  await page.getByLabel("State code").fill("KA");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.waitForURL(`${APP}/dashboard`);

  // Configure two industries directly — the self-serve editor is Phase 5, and
  // templates are Phase 3; what is being proved here is the rendering.
  const { data: org, error: orgErr } = await admin
    .from("organisations").select("id").eq("legal_name", ORG_NAME).single();
  if (orgErr) throw new Error(`could not find the org just created: ${orgErr.message}`);
  await admin.from("parties").insert({ org_id: org.id, name: "Counterparty Co" });

  const { data: freight, error: freightErr } = await admin.from("activity_types").insert({
    org_id: org.id, key: "trip", label_singular: "Trip", label_plural: "Trips",
    direction: "receivable", pricing_strategy: "manual", sort_order: 0,
  }).select("id").single();
  if (freightErr) throw new Error(`freight type: ${freightErr.message}`);
  await admin.from("activity_fields").insert([
    fieldRow(freight.id, org.id, { key: "origin", label: "Origin", field_type: "text", is_required: true, sort_order: 0 }),
    fieldRow(freight.id, org.id, { key: "destination", label: "Destination", field_type: "text", is_required: true, sort_order: 1 }),
  ]);

  const { data: intake, error: intakeErr } = await admin.from("activity_types").insert({
    org_id: org.id, key: "material_intake", label_singular: "Material intake", label_plural: "Material intakes",
    direction: "payable", pricing_strategy: "quantity_rate",
    pricing_config: { quantity_field: "weight_kg", rate_minor: 4200 }, sort_order: 1,
  }).select("id").single();
  if (intakeErr) throw new Error(`intake type: ${intakeErr.message}`);
  await admin.from("activity_fields").insert([
    fieldRow(intake.id, org.id, { key: "material_grade", label: "Material grade", field_type: "select", options: ["PET", "HDPE", "Mixed"], is_required: true, sort_order: 0 }),
    fieldRow(intake.id, org.id, { key: "weight_kg", label: "Weight (kg)", field_type: "number", is_required: true, sort_order: 1 }),
  ]);

  await page.goto(`${APP}/activities`);
  await page.waitForTimeout(500);
  await page.selectOption("#type", { label: "Trip" });
  await page.waitForTimeout(300);

  // Freight selected: its fields, and nobody else's.
  check("freight type shows Origin", await page.getByLabel("Origin").isVisible());
  check("freight type shows Destination", await page.getByLabel("Destination").isVisible());
  check("freight type does NOT show Material grade",
    (await page.getByLabel("Material grade").count()) === 0);
  check("a manual-priced type asks for the amount",
    await page.getByLabel(/^Amount/).isVisible());
  await page.screenshot({ path: "/tmp/moonbook-form-freight.png" });

  // Switch type — the same component, a different industry.
  await page.selectOption("#type", { label: "Material intake (we pay)" });
  await page.waitForTimeout(300);
  check("scrap type shows Material grade", await page.getByLabel("Material grade").isVisible());
  check("scrap type shows Weight (kg)", await page.getByLabel("Weight (kg)").isVisible());
  check("scrap type no longer shows Origin", (await page.getByLabel("Origin").count()) === 0);
  check("a quantity-priced type does NOT ask for the amount",
    (await page.getByLabel(/^Amount \(/).count()) === 0);

  // The select renders its configured options, not a free-text box.
  const options = await page.locator("#f-material_grade option").allTextContents();
  check("the select offers exactly its configured options",
    JSON.stringify(options) === JSON.stringify(["Select…", "PET", "HDPE", "Mixed"]),
    JSON.stringify(options));

  // Pricing previews live from the entered quantity.
  await page.selectOption("#f-material_grade", "PET");
  await page.fill("#f-weight_kg", "500");
  await page.waitForTimeout(300);
  const preview = await page.locator("form").getByText(/Amount:/).textContent();
  check("the amount previews from quantity × rate before saving",
    preview?.includes("21,000"), preview ?? "no preview");
  await page.screenshot({ path: "/tmp/moonbook-form-scrap.png" });

  // Record it for real.
  await page.selectOption("#party", { label: "Counterparty Co" });
  await page.getByRole("button", { name: "Record" }).click();
  await page.waitForTimeout(1200);
  const rowText = await page.locator("table tbody").textContent();
  check("the recorded row appears with its computed amount",
    rowText?.includes("Material intake") && rowText?.includes("21,000.00"),
    `POST → ${lastPost ?? "no request seen"} | table: ${rowText?.slice(0, 120)}`);

  await page.screenshot({ path: "/tmp/moonbook-activities.png" });

  const failed = results.filter((r) => !r).length;
  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${results.length - failed} passed, ${failed} failed\n`);
  await browser.close();
  process.exit(failed === 0 ? 0 : 1);
} catch (err) {
  console.error("\ncrashed:", err.message);
  await page.screenshot({ path: "/tmp/moonbook-form-failure.png" }).catch(() => {});
  await browser.close();
  process.exit(1);
}
