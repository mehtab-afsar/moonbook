import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";
import { isSupportedCurrency } from "@/lib/money";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

const createOrganisationSchema = z.object({
  legal_name: z.string().trim().min(2, "business name is required").max(200),
  country_code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "must be a 2-letter country code"),
  base_currency: z
    .string().trim().toUpperCase()
    .regex(/^[A-Z]{3}$/, "must be a 3-letter currency code")
    .refine(isSupportedCurrency, "that currency is not supported yet"),
  region_code: z.string().trim().max(10).optional().nullable(),
  locale: z.string().trim().min(2).max(35).default("en"),
  timezone: z.string().trim().min(1).max(64).default("UTC"),
  fiscal_year_start_month: z.number().int().min(1).max(12).default(1),
  tax_regime: z.enum(["none", "single_rate", "split_rate"]).default("none"),
  default_tax_rate_pct: z.number().min(0).max(100).default(0),
  tax_id: z.string().trim().max(40).optional().nullable(),
  tax_id_kind: z.string().trim().max(20).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  full_name: z.string().trim().max(120).optional().nullable(),
  /** Which industry template to copy in. Rows, not code — see migration 12. */
  template_key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/).default("generic"),
  invoice_prefix: z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/).default("INV"),
  credit_note_prefix: z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/).default("CN"),
});

/**
 * The one route that cannot use verifyAuth(): that requires a profiles row,
 * which is exactly what this call creates. The check here is only "is anyone
 * signed in at all" — create_organisation() is the real authorisation
 * boundary, and it rejects a caller who already belongs to an organisation.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return apiErr("Not signed in", 401);

  const parsed = await parseBody(req, createOrganisationSchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);
  const v = parsed.data;

  const { data, error } = await supabase
    .rpc("create_organisation", {
      p_legal_name: v.legal_name,
      p_country_code: v.country_code,
      p_base_currency: v.base_currency,
      p_region_code: v.region_code ?? undefined,
      p_locale: v.locale,
      p_timezone: v.timezone,
      p_fiscal_year_start_month: v.fiscal_year_start_month,
      p_tax_regime: v.tax_regime,
      p_default_tax_rate_pct: v.default_tax_rate_pct,
      p_tax_id: v.tax_id ?? undefined,
      p_tax_id_kind: v.tax_id_kind ?? undefined,
      p_address: v.address ?? undefined,
      p_full_name: v.full_name ?? undefined,
      p_invoice_prefix: v.invoice_prefix,
      p_credit_note_prefix: v.credit_note_prefix,
    })
    .single();

  if (error) return rpcError("POST /api/organisations", error, "Could not set up your business");

  // Copy the chosen industry's configuration in. Deliberately a SECOND call
  // rather than folding a template argument into create_organisation: that
  // would mean redefining a working function, and a business whose template
  // fails to apply still has a usable organisation it can pick one for later.
  const { error: templateError } = await supabase.rpc("apply_industry_template", {
    p_template_key: v.template_key,
  });
  if (templateError) {
    log.warn("POST /api/organisations: template not applied", {
      err: templateError.message,
      template_key: v.template_key,
    });
  }

  return apiOk({ ...data, template_applied: !templateError }, 201);
}
