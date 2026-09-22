import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";
import { LINK_AGGREGATES } from "@/lib/domain";

export const runtime = "nodejs";

const bodySchema = z.object({
  from_activity_type_id: z.uuid(),
  to_activity_type_id: z.uuid(),
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/, "lowercase, start with a letter, letters/numbers/underscores only"),
  label: z.string().trim().min(1).max(80),
  aggregate: z.enum(LINK_AGGREGATES).default("none"),
});

export async function POST(req: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("add_activity_link_type", {
      p_from_activity_type_id: v.from_activity_type_id,
      p_to_activity_type_id: v.to_activity_type_id,
      p_key: v.key,
      p_label: v.label,
      p_aggregate: v.aggregate,
    })
    .single();

  if (error) return rpcError("POST /api/settings/activity-link-types", error, "Could not add this relationship");
  return apiOk(data, 201);
}
