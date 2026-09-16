/**
 * Phase 4, through the browser — the invoicing screens a customer actually uses.
 *
 * The API gate (verify-documents.mjs) proves the ledger and the renderer are
 * right. This proves a person can reach them: sign up, record work, bill it,
 * look at the invoice, open the PDF, take a payment, and see the balance move.
 *
 * It runs a freight business, so the "what am I billing for?" list shows a
 * trip's own configured fields — the industry reaching the screen without a
 * line of industry-specific UI.
 *
 *   npm run dev   # in another terminal
 *   node scripts/verify-document-ui.mjs
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const APP = process.env.APP_URL ?? "http://localhost:3000";
const MAILPIT = "http://127.0.0.1:56324";
const RUN = Date.now().toString(36);
const EMAIL = `ui+${RUN}@moonbook.test`;
const ORG = `Sahyadri Roadlines ${RUN}`;

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let passed = 0;
const failures = [];
const check = (label, ok, detail = "") => {
  if (ok) { passed += 1; console.log(`  ✓ ${label}`); }
  else { failures.push(label); console.log(`  ✗ ${label}\n      ${detail}`); }
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });

let lastError = null;
page.on("response", async (r) => {
  if (r.url().includes("/api/") && r.status() >= 400) {
    lastError = `${r.request().method()} ${new URL(r.url()).pathname} → ${r.status()} ${await r.text().catch(() => "")}`;
  }
});

try {
  console.log("\nMoonbook — the invoicing screens\n");

  // ── Sign up as a freight business ────────────────────────────────────────
  console.log("Signing up");
  await page.goto(`${APP}/start`);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByRole("button", { name: "Send me a sign-in link" }).click();
  await page.getByText("Check your email.").waitFor();
  await page.goto(await signInLink(EMAIL));
  await page.waitForURL(`${APP}/start`);

  await page.getByLabel("Business name").fill(ORG);
  await page.getByText("Freight & logistics").click();
  await page.getByLabel("State code").fill("KA");
  await page.getByLabel("GSTIN").fill(`29AABCS${RUN.slice(-4).toUpperCase()}1Z5`);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.waitForURL(`${APP}/dashboard`);
  check("a freight business is set up and signed in", true);

  // A customer to bill. Created directly: the parties screen is not Phase 4.
  const { data: orgRow } = await admin.from("organisations").select("id").eq("legal_name", ORG).single();
  const { data: partyRow } = await admin.from("parties").insert({
    org_id: orgRow.id, name: "Konkan Ceramics", country_code: "IN", region_code: "KA",
    payment_terms_days: 15, address: "Survey 41, Belur Industrial Area, Dharwad 580011",
  }).select("id").single();

  // ── Record two trips ─────────────────────────────────────────────────────
  console.log("\nRecording work");
  await page.goto(`${APP}/activities`);
  for (const [origin, destination, vehicle, amount] of [
    ["Dharwad", "Belagavi", "KA25AB4411", "38000"],
    ["Dharwad", "Mangaluru", "KA25CD7788", "52500"],
  ]) {
    await page.getByLabel("Party").selectOption({ label: "Konkan Ceramics" });
    await page.getByLabel("Origin").fill(origin);
    await page.getByLabel("Destination").fill(destination);
    await page.getByLabel("Vehicle no.").fill(vehicle);
    await page.getByLabel("Load type").selectOption("Full truckload");
    await page.getByLabel("Amount").fill(amount);
    await page.getByRole("button", { name: /Record/ }).click();
    await page.getByRole("cell", { name: destination, exact: false }).first().waitFor({ timeout: 10000 })
      .catch(() => {});
  }
  await page.goto(`${APP}/activities`);
  const trips = await page.getByRole("row").filter({ hasText: "Trip" }).count();
  check("both trips appear in the activity log", trips === 2, `${trips} rows — ${lastError ?? ""}`);

  // The ledger only bills COMPLETED work, and the form records as completed.
  const { data: acts } = await admin.from("activities").select("status").eq("org_id", orgRow.id);
  check("and are recorded as completed, so they are billable",
    acts.length === 2 && acts.every((a) => a.status === "completed"),
    JSON.stringify(acts));

  // ── Bill them ────────────────────────────────────────────────────────────
  console.log("\nIssuing an invoice");
  await page.goto(`${APP}/documents`);
  await page.getByRole("link", { name: "Issue an invoice" }).click();
  await page.waitForURL(`${APP}/documents/new`);

  await page.getByLabel("Who are you billing?").selectOption(partyRow.id);
  const shown = await page.getByText("Origin: Dharwad · Destination: Belagavi", { exact: false }).count();
  check("the billable work shows this industry's own fields, with no industry code in the page",
    shown > 0, `matched ${shown} — ${lastError ?? ""}`);
  await page.screenshot({ path: "/tmp/moonbook-issue-form.png" });

  // Check both, and confirm the preview adds up before anything is submitted.
  const boxes = page.locator('input[type="checkbox"]');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByText("2 items, taxable value").waitFor();
  // The web UI formats with the symbol; only the PDF uses the ISO code, since
  // only the PDF has a font without a rupee glyph.
  const preview = await page.locator("body").innerText();
  check("the preview totals the chosen work",
    preview.includes("\u20B990,500.00"), preview.slice(0, 400));

  // The due date follows the party's terms rather than being typed.
  const due = await page.getByLabel("Due").inputValue();
  const docDate = await page.getByLabel("Invoice date").inputValue();
  const expectedDue = new Date(`${docDate}T00:00:00Z`);
  expectedDue.setUTCDate(expectedDue.getUTCDate() + 15);
  check("the due date comes from the party's 15-day terms",
    due === expectedDue.toISOString().slice(0, 10), `${docDate} → ${due}`);

  await page.getByRole("button", { name: "Issue invoice" }).click();
  await page.waitForURL(/\/documents\/[0-9a-f-]{36}$/, { timeout: 15000 });
  check("issuing lands on the new invoice", true);

  // ── The invoice, on screen ───────────────────────────────────────────────
  console.log("\nThe invoice");
  const body = await page.locator("body").innerText();
  check("it is numbered from the April financial year series",
    /INV-\d{4}-000001/.test(body), body.slice(0, 200));
  check("GST is split into CGST and SGST, because customer and seller share a state",
    body.includes("CGST 9%") && body.includes("SGST 9%"), body.slice(0, 400));
  check("the total is the taxable value plus 18%",
    body.includes("1,06,790.00"), body.slice(0, 600));
  check("each line still carries the trip's own details",
    body.includes("Vehicle no.: KA25AB4411"), body.slice(0, 600));
  await page.screenshot({ path: "/tmp/moonbook-invoice.png", fullPage: true });

  // ── The PDF, from the same page ──────────────────────────────────────────
  const docUrl = page.url();
  const docId = docUrl.split("/").pop();
  const pdf = await page.request.get(`${APP}/api/documents/${docId}/pdf`);
  const pdfBody = Buffer.from(await pdf.body());
  check("the PDF link on the page serves a real PDF",
    pdf.status() === 200 &&
      pdf.headers()["content-type"].includes("application/pdf") &&
      pdfBody.subarray(0, 5).toString() === "%PDF-",
    `${pdf.status()} ${pdf.headers()["content-type"]} ${pdfBody.length}b`);

  // ── Take a payment ───────────────────────────────────────────────────────
  console.log("\nTaking a payment");
  await page.getByRole("button", { name: "Record a payment" }).click();
  await page.getByLabel("Amount received").fill("50000");
  await page.getByRole("button", { name: "Record it" }).click();
  // The form closes and the page refreshes; wait for the receipt to appear
  // rather than for a heading that was on screen the whole time.
  await page.getByRole("button", { name: "Record a payment" }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);

  const afterPay = await page.locator("body").innerText();
  check("the payment is listed against the invoice", afterPay.includes("bank"), afterPay.slice(0, 300));
  check("and the outstanding balance drops by exactly that much",
    afterPay.includes("56,790.00"), afterPay.slice(0, 700));
  check("the invoice now reads as part paid", afterPay.includes("Part paid"), afterPay.slice(0, 200));
  await page.screenshot({ path: "/tmp/moonbook-invoice-paid.png", fullPage: true });

  // ── And on the list and the dashboard ────────────────────────────────────
  console.log("\nWhere it shows up");
  await page.goto(`${APP}/documents`);
  const list = await page.locator("body").innerText();
  check("the documents list shows it with its outstanding balance",
    list.includes("Part paid") && list.includes("56,790.00"), list.slice(0, 500));
  await page.screenshot({ path: "/tmp/moonbook-documents.png" });

  await page.goto(`${APP}/dashboard`);
  const dash = await page.locator("body").innerText();
  check("the dashboard counts it as outstanding, in the org's own currency",
    dash.includes("Outstanding (INR)") && dash.includes("56,790.00"), dash.slice(0, 500));

  // Billed work must not be billable twice.
  await page.goto(`${APP}/documents/new`);
  await page.getByLabel("Who are you billing?").selectOption(partyRow.id);
  const left = await page.getByText("Nothing completed and unbilled").count();
  check("the work that was just billed cannot be billed again", left === 1, `${left}`);

  console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach((f) => console.log(`  · ${f}`)); process.exitCode = 1; }
} catch (e) {
  console.error("\n", e.message);
  console.error("last API error:", lastError);
  await page.screenshot({ path: "/tmp/moonbook-ui-failure.png", fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
