import { test as base, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, authCookies, signIn } from "./helpers/supabase";

/**
 * One tenant per test, created fresh and never cleaned up.
 *
 * Nothing is torn down on purpose. `documents.created_by` references the
 * profile with no cascade, so a user who has issued an invoice CANNOT be
 * deleted — the database refusing to erase who issued a document is correct
 * behaviour for an audit trail, and a suite that fought it would be arguing
 * with the product. `npm run db:reset` is the cleanup.
 *
 * Because every test brings its own organisation, the tenancy boundary is
 * exercised on every run rather than in one dedicated spec: if RLS leaked,
 * every count assertion in the suite would start failing at once.
 */

export interface TenantOptions {
  /** Defaults to India + split-rate GST — the shape most specs want. */
  country?: "IN" | "GB" | "AE" | "US";
  regionCode?: string | null;
  templateKey?: "freight" | "scrap" | "hospitality" | "wholesale" | "generic";
  taxId?: string | null;
  label?: string;
}

export interface Tenant {
  email: string;
  orgId: string;
  orgName: string;
  /** User-scoped, so RLS applies exactly as it does in the app. */
  db: SupabaseClient;
  page: Page;
  context: BrowserContext;
}

const COUNTRY: Record<
  string,
  { currency: string; locale: string; timezone: string; fyStart: number;
    regime: "none" | "single_rate" | "split_rate"; rate: number; taxIdKind: string }
> = {
  IN: { currency: "INR", locale: "en-IN", timezone: "Asia/Kolkata", fyStart: 4, regime: "split_rate", rate: 18, taxIdKind: "GSTIN" },
  GB: { currency: "GBP", locale: "en-GB", timezone: "Europe/London", fyStart: 1, regime: "single_rate", rate: 20, taxIdKind: "VAT" },
  AE: { currency: "AED", locale: "en-AE", timezone: "Asia/Dubai", fyStart: 1, regime: "single_rate", rate: 5, taxIdKind: "TRN" },
  US: { currency: "USD", locale: "en-US", timezone: "America/New_York", fyStart: 1, regime: "none", rate: 0, taxIdKind: "EIN" },
};

let counter = 0;
/** Unique across workers as well as within one: workers are separate processes. */
function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now().toString(36)}${process.pid.toString(36)}${counter}`;
}

/**
 * A second person in the same organisation, as a member of staff.
 *
 * There is no invite flow in the product yet — `create_organisation` makes its
 * caller the owner and nothing else writes `profiles` — so the row is inserted
 * with the service role, which is what an operator adding a colleague would do
 * today. That absence is a real gap, but it is a separate one from whether the
 * role is ENFORCED, which is what these tests are for.
 */
export async function addStaffMember(
  browser: Browser,
  baseURL: string,
  tenant: Tenant,
): Promise<Tenant> {
  const email = `staff+${uniqueSuffix()}@moonbook.test`;
  const { client, session } = await signIn(email);

  const { data: user } = await client.auth.getUser();
  const { error } = await adminClient()
    .from("profiles")
    .insert({ id: user.user!.id, org_id: tenant.orgId, role: "staff", full_name: "A Colleague" });
  if (error) throw new Error(`addStaffMember: ${error.message}`);

  const context = await browser.newContext();
  await context.addCookies(authCookies(session, baseURL));
  const page = await context.newPage();

  return { email, orgId: tenant.orgId, orgName: tenant.orgName, db: client, page, context };
}

export const test = base.extend<{
  admin: SupabaseClient;
  /** Build another tenant — for cross-tenant assertions. Closed automatically. */
  newTenant: (opts?: TenantOptions) => Promise<Tenant>;
  /** The tenant this test runs as, already signed in and set up. */
  tenant: Tenant;
}>({
  admin: async ({}, use) => {
    await use(adminClient());
  },

  newTenant: async ({ browser, baseURL }, use) => {
    const opened: BrowserContext[] = [];

    await use(async (opts: TenantOptions = {}) => {
      const suffix = uniqueSuffix();
      const country = opts.country ?? "IN";
      const d = COUNTRY[country];
      const email = `e2e+${suffix}@moonbook.test`;
      const orgName = `${opts.label ?? "Tenant"} ${suffix}`;

      const { client, session } = await signIn(email);

      const { data: org, error } = await client
        .rpc("create_organisation", {
          p_legal_name: orgName,
          p_country_code: country,
          p_base_currency: d.currency,
          p_region_code: opts.regionCode === undefined
            ? (country === "IN" ? "KA" : null)
            : opts.regionCode,
          p_locale: d.locale,
          p_timezone: d.timezone,
          p_fiscal_year_start_month: d.fyStart,
          p_tax_regime: d.regime,
          p_default_tax_rate_pct: d.rate,
          p_tax_id: opts.taxId === undefined ? `TAX${suffix.toUpperCase()}` : opts.taxId,
          p_tax_id_kind: opts.taxId === null ? null : d.taxIdKind,
        })
        .single<{ org_id: string }>();
      if (error) throw new Error(`create_organisation: ${error.message}`);

      const { error: templateErr } = await client.rpc("apply_industry_template", {
        p_template_key: opts.templateKey ?? "freight",
      });
      if (templateErr) throw new Error(`apply_industry_template: ${templateErr.message}`);

      const context = await browser.newContext();
      opened.push(context);
      await context.addCookies(authCookies(session, baseURL!));
      const page = await context.newPage();

      return { email, orgId: org!.org_id, orgName, db: client, page, context };
    });

    for (const context of opened) await context.close();
  },

  tenant: async ({ newTenant }, use) => {
    await use(await newTenant());
  },

  /**
   * The default `page` is the tenant's, so a spec never accidentally drives a
   * signed-out browser and reads the redirect as a product failure.
   */
  page: async ({ tenant }, use) => {
    await use(tenant.page);
  },
});

export { expect } from "@playwright/test";

/** Today where the tenant is, matching what the server renders. */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
