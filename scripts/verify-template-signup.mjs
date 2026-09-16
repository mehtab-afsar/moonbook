/**
 * The signup picker, in a browser: the industry choices come from the
 * database, so an industry added by an operator appears with no deploy.
 *
 *   npm run dev && npx supabase db reset && node scripts/verify-template-signup.mjs
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.local" });

const APP = "http://localhost:3000";
const MAILPIT = "http://127.0.0.1:56324";
const EMAIL = `tmpl-${Date.now()}@moonbook.test`;

const results = [];
const check = (l, ok, d = "") => { results.push(ok); console.log(`  ${ok ? "✓" : "✗"} ${l}${ok ? "" : `\n      ${d}`}`); };

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

const psql = (sqlText) =>
  execFileSync("psql", [process.env.SUPABASE_DB_URL, "-v", "ON_ERROR_STOP=1", "-q", "-c", sqlText], {
    encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" },
  });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });

try {
  console.log("\nMoonbook — the industry picker at signup\n");

  await page.goto(`${APP}/start`);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByRole("button", { name: "Send me a sign-in link" }).click();
  await page.getByText("Check your email.").waitFor();
  await page.goto(await signInLink(EMAIL));
  await page.waitForURL(`${APP}/start`);

  check("signup asks what kind of business this is",
    await page.getByText("What kind of business is this?").isVisible());
  check("it offers the freight template", await page.getByText("Freight & logistics").isVisible());
  check("and the generic one", await page.getByText("Something else").isVisible());
  await page.screenshot({ path: "/tmp/moonbook-picker.png" });

  // An operator adds an industry. No deploy, no restart.
  psql(`insert into public.industry_templates (key, label, description, sort_order)
        values ('rental', 'Equipment rental',
                'Hire equipment out by the day and bill for the period it was on hire.', 2)
        on conflict (key) do nothing;`);

  await page.reload();
  check("a newly inserted industry appears without a deploy",
    await page.getByText("Equipment rental").isVisible());

  // Pick freight and finish.
  await page.getByLabel("Business name").fill("Picker Test Freight");
  await page.getByText("Freight & logistics").click();
  await page.selectOption("#country", "IN");
  await page.getByLabel("State code").fill("KA");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.waitForURL(`${APP}/dashboard`, { timeout: 15000 });
  check("setup completes", true);

  // The chosen industry's fields are live on the activity form.
  await page.goto(`${APP}/activities`);
  await page.waitForTimeout(600);
  check("the chosen template's fields are already there — Origin",
    await page.getByLabel("Origin").isVisible());
  check("and Destination", await page.getByLabel("Destination").isVisible());
  check("and its reportable select, with the template's options",
    JSON.stringify(await page.locator("#f-load_type option").allTextContents()) ===
      JSON.stringify(["Select…", "Full truckload", "Part load", "Express"]),
    JSON.stringify(await page.locator("#f-load_type option").allTextContents()));
  await page.screenshot({ path: "/tmp/moonbook-templated-form.png" });

  const failed = results.filter((r) => !r).length;
  console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${results.length - failed} passed, ${failed} failed\n`);
  await browser.close();
  process.exit(failed === 0 ? 0 : 1);
} catch (err) {
  console.error("\ncrashed:", err.message);
  await page.screenshot({ path: "/tmp/moonbook-picker-failure.png" }).catch(() => {});
  await browser.close();
  process.exit(1);
}
