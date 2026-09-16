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
import { EDITABLE_ACTIVITY_STATUSES } from "@/lib/domain";

export const runtime = "nodejs";

/**
 * Correcting recorded work.
 *
 * A full replacement rather than a patch, matching update_activity: the form
 * loads the row, shows it filled in, and submits all of it. A partial update
 * would need NULL to mean "leave alone", which makes clearing a nullable
 * field impossible.
 *
 * The amount is recomputed here from the pricing strategy for the same reason
 * it is on the way in — a client that could name its own amount on a
 * quantity_rate type could bill any figure regardless of what was recorded.
 */
const updateSchema = z.object({
  party_id: z.uuid(),
  occurred_on: z.iso.date(),
  bill_to_party_id: z.uuid().optional().nullable(),
  reference: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  details: z.record(z.string(), z.unknown()).default({}),
  amount_minor: z.number().int().min(0).optional(),
  period_start: z.iso.date().optional().nullable(),
  period_end: z.iso.date().optional().nullable(),
  status: z.enum(EDITABLE_ACTIVITY_STATUSES).default("completed"),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const { id } = await params;
  const parsed = await parseBody(req, updateSchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);
  const v = parsed.data;

  const supabase = await createClient();

  // RLS scopes this, so another tenant's activity simply is not there.
  const { data: activity, error: readErr } = await supabase
    .from("activities")
    .select("id, activity_type_id, status")
    .eq("id", id)
    .maybeSingle();

  if (readErr) return apiErr("Could not load this activity", 500);
  if (!activity) return apiErr("Activity not found", 404);

  // The currency a `money` field's value is expressed in. Read from the
  // organisation, never from the request — it decides what the number means.
  const { data: org, error: orgErr } = await supabase
    .from("organisations").select("base_currency").eq("id", auth.ctx.orgId).single();
  if (orgErr) return apiErr("Could not load your organisation", 500);

  const { data: type, error: typeErr } = await supabase
    .from("activity_types")
    // FK named: activity_fields reaches activity_types by two paths.
    .select("id, pricing_strategy, pricing_config, activity_fields!activity_fields_activity_type_id_fkey(key, label, field_type, options, is_required, archived_at)")
    .eq("id", activity.activity_type_id)
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
    .rpc("update_activity", {
      p_activity_id: id,
      p_party_id: v.party_id,
      p_occurred_on: v.occurred_on,
      p_amount_minor: amountMinor,
      p_bill_to_party_id: v.bill_to_party_id ?? undefined,
      p_reference: v.reference ?? undefined,
      p_details: details as never,
      p_period_start: v.period_start ?? undefined,
      p_period_end: v.period_end ?? undefined,
      p_notes: v.notes ?? undefined,
      p_status: v.status,
    })
    .single();

  if (error) return rpcError("PATCH /api/activities/[id]", error, "Could not save this correction");
  return apiOk({ ...data, amount_minor: amountMinor });
}
