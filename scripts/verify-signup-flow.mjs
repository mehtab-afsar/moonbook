/**
 * Drives the real signup → setup → dashboard flow in a browser, through the
 * actual UI and the actual magic-link email. No faked cookies: the PKCE
 * code_verifier this client stores must be the one the emailed link matches,
 * which is only true if the sign-in genuinely happens in the browser.
 *
 *   npm run dev            (in another terminal)
 *   node scripts/verify-signup-flow.mjs
 */
import { chromium } from "playwright";
import { config } from "dotenv";

config({ path: ".env.local" });

const APP = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const MAILPIT = "http://127.0.0.1:56324";
const EMAIL = `founder-${Date.now()}@moonbook.test`;

async function signInLink(email) {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(email)}&limit=1`);
    const body = await res.json();
    if (body.messages?.length) {
      const msg = await fetch(`${MAILPIT}/api/v1/message/${body.messages[0].ID}`).then((r) => r.json());
      const m = msg.Text.match(/http:\/\/127\.0\.0\.1:56321\/auth\/v1\/verify\?[^\s)]+/);
      if (m) return m[0];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("no sign-in email arrived in Mailpit");
}

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n      ${detail}`}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  console.log("\nMoonbook — signup flow\n");

  await page.goto(`${APP}/dashboard`);
  check("signed-out /dashboard redirects away", new URL(page.url()).pathname === "/", page.url());

  await page.goto(`${APP}/start`);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByRole("button", { name: "Send me a sign-in link" }).click();
  await page.getByText("Check your email.").waitFor({ timeout: 10000 });
  check("magic link requested from /start", true);

  await page.goto(await signInLink(EMAIL));
  await page.waitForURL(`${APP}/start`, { timeout: 15000 });
  check("the emailed link lands a profile-less user on setup, not the dashboard", true);

  await page.getByLabel("Business name").fill("Sunrise Traders");
  await page.selectOption("#country", "IN");
  await page.getByLabel("State code").fill("KA");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.waitForURL(`${APP}/dashboard`, { timeout: 15000 });
  check("setup completes and lands on the dashboard", true);

  const heading = await page.getByRole("heading", { name: "Dashboard" }).isVisible();
  check("dashboard renders", heading);

  const empty = await page.getByText("Nothing outstanding yet").isVisible();
  check("a brand-new business sees an honest empty state", empty);

  // Hovering the rail must not shift the page — the reason it is an overlay.
  const before = await page.locator("main").boundingBox();
  await page.locator("aside").hover();
  await page.waitForTimeout(400);
  const after = await page.locator("main").boundingBox();
  check("expanding the sidebar does not shift the page", before.x === after.x, `${before.x} → ${after.x}`);

  await page.goto(`${APP}/start`);
  check("revisiting /start once set up redirects to the dashboard",
    new URL(page.url()).pathname === "/dashboard", page.url());

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? "PASS" : "FAIL"} — ${results.length - failed.length} passed, ${failed.length} failed\n`);
  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
} catch (err) {
  console.error("\nflow crashed:", err.message);
  await page.screenshot({ path: "/tmp/moonbook-flow-failure.png" }).catch(() => {});
  await browser.close();
  process.exit(1);
}
