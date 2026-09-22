import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";
import { DIRECTIONS, PRICING_STRATEGIES } from "@/lib/domain";

export const runtime = "nodejs";

const bodySchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/, "lowercase, start with a letter, letters/numbers/underscores only"),
  label_singular: z.string().trim().min(1).max(60),
  label_plural: z.string().trim().min(1).max(60),
  direction: z.enum(DIRECTIONS),
  pricing_strategy: z.enum(PRICING_STRATEGIES).default("manual"),
  uses_period: z.boolean().default(false),
  uses_job_margin: z.boolean().default(true),
});

/** Adds a brand-new activity type to this org's own ontology — the RLS for
 *  this already existed; see 20261001000011_self_serve_activity_types.sql. */
export async function POST(req: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("add_activity_type", {
      p_key: v.key,
      p_label_singular: v.label_singular,
      p_label_plural: v.label_plural,
      p_direction: v.direction,
      p_pricing_strategy: v.pricing_strategy,
      p_pricing_config: {} as never,
      p_uses_period: v.uses_period,
      p_uses_job_margin: v.uses_job_margin,
    })
    .single();

  if (error) return rpcError("POST /api/settings/activity-types", error, "Could not add this activity type");
  return apiOk(data, 201);
}
