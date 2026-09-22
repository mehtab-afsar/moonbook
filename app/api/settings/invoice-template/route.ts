import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";
import { INVOICE_TEMPLATES } from "@/lib/pdf/templates/meta";

export const runtime = "nodejs";

const TEMPLATE_KEYS = INVOICE_TEMPLATES.map((t) => t.key) as [string, ...string[]];
const bodySchema = z.object({ template: z.enum(TEMPLATE_KEYS) });

export async function POST(req: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("set_org_invoice_template", { p_template: parsed.data.template })
    .single();
  if (error) return rpcError("POST /api/settings/invoice-template", error, "Could not save the invoice template");

  return apiOk(data);
}
