import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";
import { buildDetailsSchema, pruneEmpty, type ActivityField } from "@/lib/activities/details-schema";
import {
  computeAmount, PricingError,
  type PricingStrategy, type PricingConfig, type PricingField,
} from "@/lib/pricing";

export const runtime = "nodejs";

const COLUMNS =
  "id, activity_type_id, party_id, bill_to_party_id, direction, currency, occurred_on, amount_minor, direct_cost_minor, tax_rate_pct, reference, status, dim1_key, dim1_value, details, created_at";

export async function GET() {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activities")
    // Both embeds name their key — activities reaches activity_types by three
    // foreign keys and parties by two, and an ambiguous embed errors.
    .select(
      `${COLUMNS}, activity_types!activities_activity_type_id_fkey(label_singular), parties!activities_party_id_fkey(name)`,
    )
    .order("occurred_on", { ascending: false })
    .limit(200);

  if (error) return apiErr("Could not load activities", 500);
  return apiOk(data);
}

const recordSchema = z.object({
  activity_type_id: z.uuid(),
  party_id: z.uuid(),
  bill_to_party_id: z.uuid().optional().nullable(),
  occurred_on: z.iso.date(),
  reference: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  /** Free-shaped: validated below against THIS type's field definitions. */
  details: z.record(z.string(), z.unknown()).default({}),
  /** Only the `manual` strategy reads this. */
  amount_minor: z.number().int().min(0).optional(),
  period_start: z.iso.date().optional().nullable(),
  period_end: z.iso.date().optional().nullable(),
  /** What this job cost to deliver — revenue minus this is its margin. */
  direct_cost_minor: z.number().int().min(0).optional().nullable(),
  /** Overrides the organisation's default tax rate for this one line. */
  tax_rate_pct: z.number().min(0).max(100).optional().nullable(),
});

/**
 * The amount is computed HERE, never sent by the client and never recomputed
 * in SQL — the same rule tax follows. A client that could name its own amount
 * on a `quantity_rate` type could bill any figure it liked regardless of what
 * was recorded.
 */
export async function POST(req: NextRequest) {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const parsed = await parseBody(req, recordSchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);
  const v = parsed.data;

  const supabase = await createClient();

  // RLS scopes this to the caller's org, so a type from another tenant simply
  // isn't there — a 404, never a 403.
  // The currency a `money` field's value is expressed in. Read from the
  // organisation, never from the request — it decides what the number means.
  const { data: org, error: orgErr } = await supabase
    .from("organisations").select("base_currency").eq("id", auth.ctx.orgId).single();
  if (orgErr) return apiErr("Could not load your organisation", 500);

  const { data: type, error: typeErr } = await supabase
    .from("activity_types")
    // FK named explicitly — activity_fields reaches activity_types by two
    // paths, and an ambiguous embed errors rather than degrading.
    .select("id, pricing_strategy, pricing_config, activity_fields!activity_fields_activity_type_id_fkey(key, label, field_type, options, is_required, archived_at)")
    .eq("id", v.activity_type_id)
    .maybeSingle();

  if (typeErr) return apiErr("Could not load that activity type", 500);
  if (!type) return apiErr("Activity type not found", 404);

  const fields = (type.activity_fields ?? []) as unknown as ActivityField[];
  const details = pruneEmpty(v.details);

  const detailsResult = buildDetailsSchema(fields).safeParse(details);
  if (!detailsResult.success) {
    const issue = detailsResult.error.issues[0];
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return apiErr(`${path}${issue.message}`, 422);
  }

  let amountMinor: number;
  try {
    ({ amountMinor } = computeAmount({
      strategy: type.pricing_strategy as PricingStrategy,
      config: (type.pricing_config ?? {}) as PricingConfig,
      details,
      manualAmountMinor: v.amount_minor,
      // A `money` rate is typed in major units, so pricing needs both the
      // currency and the field definitions to convert it exactly once.
      currency: org.base_currency,
      fields: fields as unknown as PricingField[],
    }));
  } catch (err) {
    if (err instanceof PricingError) return apiErr(err.message, 422);
    throw err;
  }

  const { data, error } = await supabase
    .rpc("record_activity", {
      p_activity_type_id: v.activity_type_id,
      p_party_id: v.party_id,
      p_occurred_on: v.occurred_on,
      p_amount_minor: amountMinor,
      p_bill_to_party_id: v.bill_to_party_id ?? undefined,
      p_reference: v.reference ?? undefined,
      // The generated Json type can't express "an object of unknown values",
      // which is exactly what a per-industry details blob is. It has already
      // been validated against this type's field definitions above.
      p_details: details as never,
      p_period_start: v.period_start ?? undefined,
      p_period_end: v.period_end ?? undefined,
      p_notes: v.notes ?? undefined,
      p_direct_cost_minor: v.direct_cost_minor ?? undefined,
      p_tax_rate_pct: v.tax_rate_pct ?? undefined,
    })
    .single();

  if (error) return rpcError("POST /api/activities", error, "Could not record this activity");
  return apiOk({ ...data, amount_minor: amountMinor }, 201);
}
