import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";

export const runtime = "nodejs";

const bodySchema = z.object({
  link_type_id: z.uuid(),
  from_activity_id: z.uuid(),
  to_activity_id: z.uuid(),
});

/** Any signed-in member of the org may link two already-recorded activities
 *  together — see link_activities()'s own comment for why this isn't
 *  owner-only the way issuing a document is. */
export async function POST(req: NextRequest) {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("link_activities", {
      p_link_type_id: v.link_type_id,
      p_from_activity_id: v.from_activity_id,
      p_to_activity_id: v.to_activity_id,
    })
    .single();

  if (error) return rpcError("POST /api/activities/links", error, "Could not create this link");
  return apiOk(data, 201);
}
