import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";
import { PRICING_STRATEGIES } from "@/lib/domain";

export const runtime = "nodejs";

const patchSchema = z.object({
  label_singular: z.string().trim().min(1).max(60),
  label_plural: z.string().trim().min(1).max(60),
  pricing_strategy: z.enum(PRICING_STRATEGIES).default("manual"),
  uses_period: z.boolean().default(false),
  uses_job_margin: z.boolean().default(true),
});

/** Presentation attributes only — key and direction are fixed at creation.
 *  See 20261001000011_self_serve_activity_types.sql for why. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const { id } = await params;
  const parsed = await parseBody(req, patchSchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("update_activity_type", {
      p_activity_type_id: id,
      p_label_singular: v.label_singular,
      p_label_plural: v.label_plural,
      p_pricing_strategy: v.pricing_strategy,
      p_pricing_config: {} as never,
      p_uses_period: v.uses_period,
      p_uses_job_margin: v.uses_job_margin,
    })
    .single();

  if (error) return rpcError("PATCH /api/settings/activity-types/[id]", error, "Could not save this activity type");
  return apiOk(data);
}

/** Soft delete — blocked while unbilled work of this type exists, so nothing
 *  becomes stranded from the normal correction flow. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("archive_activity_type", { p_activity_type_id: id }).single();

  if (error) return rpcError("DELETE /api/settings/activity-types/[id]", error, "Could not archive this activity type");
  return apiOk(data);
}
