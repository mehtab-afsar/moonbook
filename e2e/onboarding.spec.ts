import { test, expect } from "./fixtures";
import { adminClient } from "./helpers/supabase";
import { psql, lit } from "./helpers/psql";
import { waitForSignInLink } from "./helpers/mailpit";

/**
 * Signing up, through the real email.
 *
 * This is the ONE spec that waits on SMTP. Everywhere else a session is minted
 * directly, because forty specs depending on mail delivery buys no coverage
 * and loses reliability — but the link being sent, being redeemable, and
 * landing in the right place is itself a thing that can break, so it is tested
 * here properly rather than assumed.
 *
 * The other half of this file is the claim the whole product rests on: the
 * industries offered at signup are ROWS. A new one appears with no deploy.
 */

/** Never reuses the tenant fixture — this spec is about creating one. */
function freshEmail() {
  return `signup+${Date.now().toString(36)}${process.pid.toString(36)}@moonbook.test`;
}

test.describe("onboarding", () => {
  test("a new business signs up by email and sets itself up", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const email = freshEmail();
    const orgName = `Ghat Transport ${Date.now().toString(36)}`;

    try {
      await page.goto("/");
      // "Start free" appears in the header and again in the hero.
      await page.getByRole("banner").getByRole("link", { name: "Start free" }).click();
      await expect(page).toHaveURL(/\/start/);

      await page.getByLabel("Email").fill(email);
      await page.getByRole("button", { name: /Send me a sign-in link/i }).click();
      await expect(page.getByText("Check your email.")).toBeVisible();

      // The real link, out of the real inbox.
      await page.goto(await waitForSignInLink(email));
      await expect(page).toHaveURL(/\/start/);

      // Setup asks four questions, and the one that matters is the industry.
      await expect(page.getByText("What kind of business is this?")).toBeVisible();
      await page.getByLabel("Business name").fill(orgName);
      await page.getByText("Freight & logistics").click();
      await page.getByLabel("Country").selectOption("IN");
      await page.getByLabel("State code").fill("KA");
      await page.getByRole("button", { name: "Finish setup" }).click();

      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

      // Picking India set the currency, the financial year and the tax regime
      // together, rather than asking five separate questions.
      const admin = adminClient();
      const { data: org } = await admin
        .from("organisations")
        .select("base_currency, fiscal_year_start_month, tax_regime, default_tax_rate_pct, region_code")
        .eq("legal_name", orgName)
        .single();

      expect(org).toMatchObject({
        base_currency: "INR",
        fiscal_year_start_month: 4,
        tax_regime: "split_rate",
        region_code: "KA",
      });

      // And the chosen industry was copied in as the org's OWN rows.
      const { data: types } = await admin
        .from("activity_types")
        .select("key, org_id, template_key")
        .eq("template_key", "freight")
        .not("org_id", "is", null);
      expect((types ?? []).some((t) => t.key === "trip")).toBeTruthy();
    } finally {
      await context.close();
    }
  });

  test("the industries on offer come from the database, not from the page", async ({ browser }) => {
    const key = `e2e_demo_${Date.now().toString(36)}`;

    // Added the way an operator would — industry_templates has no write grant
    // for any client role, because it is shared between every business.
    // industry_templates is the CATALOGUE — what the picker offers. The
    // configuration it applies lives in activity_types/activity_fields rows
    // carrying this template_key, with org_id NULL. Offering the industry and
    // defining it are separate inserts, and this test is about the former.
    //
    // Inserted through psql because NO client role may write this table, the
    // service role included — see helpers/psql.ts. The claim under test is
    // "no application code, no schema change, no redeploy", and running it as
    // an operator is what keeps that claim honest.
    psql(
      `insert into public.industry_templates (key, label, description, sort_order)
       values (${lit(key)}, ${lit("Beekeeping co-operative")},
               ${lit("Hives, harvests and honey by the kilo.")}, 900)`,
    );

    const context = await browser.newContext();
    const page = await context.newPage();
    const email = freshEmail();
    try {
      await page.goto("/start");
      await page.getByLabel("Email").fill(email);
      await page.getByRole("button", { name: /Send me a sign-in link/i }).click();
      await page.goto(await waitForSignInLink(email));

      // No deploy, no migration, no code change — the picker simply has it.
      await expect(page.getByText("Beekeeping co-operative")).toBeVisible();
      await expect(page.getByText("Hives, harvests and honey by the kilo.")).toBeVisible();
    } finally {
      await context.close();
      psql(`delete from public.industry_templates where key = ${lit(key)}`);
    }
  });

  test("someone who already has a business is sent straight past setup", async ({ tenant }) => {
    await tenant.page.goto("/start");
    await expect(tenant.page).toHaveURL(/\/dashboard/);
  });
});
