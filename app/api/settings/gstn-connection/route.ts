import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";
import { GSTN_PROVIDERS, GSTN_ENVIRONMENTS } from "@/lib/domain";

export const runtime = "nodejs";

const bodySchema = z.object({
  provider: z.enum(GSTN_PROVIDERS),
  environment: z.enum(GSTN_ENVIRONMENTS),
  gstin: z.string().trim().min(1).max(20),
});

/**
 * Records which GSP this organisation intends to connect through — never a
 * working connection. See 20261001000008_gstn_connections.sql for why this
 * always lands as status='pending', and lib/gstn/client.ts for the seam
 * where a real integration attaches later.
 */
export async function POST(req: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("set_gstn_connection", {
      p_provider: parsed.data.provider,
      p_environment: parsed.data.environment,
      p_gstin: parsed.data.gstin,
    })
    .single();

  if (error) return rpcError("POST /api/settings/gstn-connection", error, "Could not save this connection");
  return apiOk(data);
}
