import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";

export const runtime = "nodejs";

const bodySchema = z.object({
  show_hsn: z.boolean(),
  terms: z.string().trim().max(2000).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("set_org_invoice_customization", { p_show_hsn: parsed.data.show_hsn, p_terms: parsed.data.terms ?? undefined })
    .single();
  if (error) return rpcError("POST /api/settings/invoice-customization", error, "Could not save your invoice settings");

  return apiOk(data);
}
