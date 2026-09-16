/**
 * The three screens the sidebar linked to and nothing answered.
 *
 * Until now a customer could not be added without SQL — the browser test for
 * Phase 4 had to insert one with the service role, which is a fair sign that
 * the product was not usable. This walks the whole loop through the UI alone:
 * add a party, record work, bill it, take a receipt against two invoices at
 * once, and check the settings page describes the business correctly.
 *
 * The receipt is the interesting part. It is deliberately for MORE than the
 * two invoices come to, so the remainder has to stay visible as unapplied
 * credit rather than being forced onto something.
 *
 *   npm run dev   # in another terminal
 *   node scripts/verify-back-office.mjs
 */
import { chromium } from "playwright";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const APP = process.env.APP_URL ?? "http://localhost:3000";
const MAILPIT = "http://127.0.0.1:56324";
const RUN = Date.now().toString(36);
const EMAIL = `office+${RUN}@moonbook.test`;
const ORG = `Deccan Carriers ${RUN}`;

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
  console.log("\nMoonbook — parties, payments and settings\n");

  console.log("Signing up");
  await page.goto(`${APP}/start`);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByRole("button", { name: "Send me a sign-in link" }).click();
  await page.getByText("Check your email.").waitFor();
  await page.goto(await signInLink(EMAIL));
  await page.waitForURL(`${APP}/start`);
  await page.getByLabel("Business name").fill(ORG);
  await page.getByText("Freight & logistics").click();
  await page.getByLabel("State code").fill("MH");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.waitForURL(`${APP}/dashboard`);

  // ── Parties: the gap that made this necessary ────────────────────────────
  console.log("\nAdding a customer, without SQL");
  await page.goto(`${APP}/parties`);
  check("the parties page exists at all", await page.getByRole("heading", { name: "Parties" }).isVisible());

  await page.getByRole("button", { name: "Add a party" }).click();
  await page.getByLabel("Name").fill("Godavari Polymers");
  // Under split_rate the state code is asked for, because it decides the tax
  // shape. Under any other regime the field is not rendered at all.
  check("a split-rate business is asked for the customer's state",
    await page.getByLabel("State code").isVisible());
  await page.getByLabel("State code").fill("MH");
  await page.getByLabel("Payment terms").fill("20");
  await page.getByLabel("Address").fill("Gat 214, Chakan MIDC, Pune 410501");
  await page.getByRole("button", { name: "Add party" }).click();
  await page.getByRole("cell", { name: "Godavari Polymers" }).waitFor({ timeout: 10000 });
  check("the customer is saved and listed", true);
  await page.screenshot({ path: "/tmp/moonbook-parties.png" });

  // Editing must not need a page change.
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.getByLabel("Payment terms").fill("25");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForTimeout(1200);
  const terms = await page.locator("body").innerText();
  check("and can be corrected in place", terms.includes("25d"), terms.slice(0, 400));

  // ── Two invoices ─────────────────────────────────────────────────────────
  console.log("\nBilling two jobs separately");
  for (const [origin, destination, vehicle, amount] of [
    ["Pune", "Nashik", "MH12AB1122", "40000"],
    ["Pune", "Aurangabad", "MH12CD3344", "30000"],
  ]) {
    await page.goto(`${APP}/activities`);
    await page.getByLabel("Party").selectOption({ label: "Godavari Polymers" });
    await page.getByLabel("Origin").fill(origin);
    await page.getByLabel("Destination").fill(destination);
    await page.getByLabel("Vehicle no.").fill(vehicle);
    await page.getByLabel("Load type").selectOption("Part load");
    await page.getByLabel("Amount").fill(amount);
    await page.getByRole("button", { name: /Record/ }).click();
    await page.waitForTimeout(1500);

    await page.goto(`${APP}/documents/new`);
    await page.getByLabel("Who are you billing?").selectOption({ index: 1 });
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByRole("button", { name: "Issue invoice" }).click();
    await page.waitForURL(/\/documents\/[0-9a-f-]{36}$/, { timeout: 15000 });
  }
  await page.goto(`${APP}/documents`);
  const docs = await page.locator("body").innerText();
  check("two invoices are issued, numbered in sequence",
    docs.includes("INV-2627-000001") && docs.includes("INV-2627-000002"), docs.slice(0, 500));
  // 40,000 + 18% = 47,200 and 30,000 + 18% = 35,400.
  check("each carries its own GST", docs.includes("47,200.00") && docs.includes("35,400.00"),
    docs.slice(0, 600));

  // ── One receipt against both, plus change ────────────────────────────────
  console.log("\nOne receipt settling both, with money left over");
  await page.goto(`${APP}/payments`);
  check("the payments page exists", await page.getByRole("heading", { name: "Payments" }).isVisible());

  await page.getByLabel("Who paid?").selectOption({ index: 1 });
  // The two invoices come to 82,600. Pay 90,000.
  await page.getByLabel("Amount received").fill("90000");
  await page.getByText("What does this settle?").waitFor();

  const split = await page.locator("body").innerText();
  check("it allocates oldest-first across both invoices without being asked",
    split.includes("₹7,400.00 will be left unapplied"), split.slice(0, 900));
  await page.screenshot({ path: "/tmp/moonbook-receipt.png" });

  await page.getByRole("button", { name: "Record receipt" }).click();
  await page.waitForTimeout(2000);

  const after = await page.locator("body").innerText();
  check("the receipt is recorded", after.includes("₹90,000.00"), after.slice(0, 600));
  check("and the remainder is held as unapplied credit, not forced onto an invoice",
    after.includes("₹7,400.00"), after.slice(0, 900));

  await page.goto(`${APP}/documents`);
  const settled = await page.locator("body").innerText();
  const settledCount = (settled.match(/Settled/g) ?? []).length;
  check("both invoices now read as settled", settledCount === 2, `${settledCount} — ${settled.slice(0, 400)}`);

  await page.goto(`${APP}/dashboard`);
  const dash = await page.locator("body").innerText();
  check("and the dashboard shows nothing outstanding",
    dash.includes("Nothing outstanding yet") || dash.includes("No outstanding balances"),
    dash.slice(0, 400));

  // ── Settings describes what was configured ───────────────────────────────
  console.log("\nSettings");
  await page.goto(`${APP}/settings`);
  const set = await page.locator("body").innerText();
  check("the settings page exists", await page.getByRole("heading", { name: "Settings" }).isVisible());
  check("it names the tax regime in words rather than in jargon",
    set.includes("One rate split in two"), set.slice(0, 700));
  check("it shows the April financial year this business was set up with",
    set.includes("April"), set.slice(0, 900));
  check("and the numbering rule, including that numbers are gapless",
    set.includes("INV") && set.includes("resets each financial year"), set.slice(0, 1200));
  check("it lists the fields this industry records, which are the org's own",
    set.includes("Origin") && set.includes("Destination") && set.includes("Vehicle no."),
    set.slice(0, 1600));
  await page.screenshot({ path: "/tmp/moonbook-settings.png", fullPage: true });

  console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach((f) => console.log(`  · ${f}`)); process.exitCode = 1; }
} catch (e) {
  console.error("\n", e.message);
  console.error("last API error:", lastError);
  await page.screenshot({ path: "/tmp/moonbook-office-failure.png", fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
