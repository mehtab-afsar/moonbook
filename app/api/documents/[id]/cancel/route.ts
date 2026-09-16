import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";

export const runtime = "nodejs";

/**
 * Cancelling a document.
 *
 * `cancel_document` refuses once anything has been applied, so an invoice that
 * has taken money cannot be voided out from under the payment — a credit note
 * is the instrument for that, and this route's error says so. Cancelling frees
 * the activities it billed AND deletes its lines, so the work is genuinely
 * re-billable rather than reopened in name only.
 *
 * A reason is required by the RPC, not by politeness: it is the only record of
 * why a number in the book was voided.
 */
const cancelSchema = z.object({
  reason: z.string().trim().min(3, "a reason is required").max(500),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const { id } = await params;
  const parsed = await parseBody(req, cancelSchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("cancel_document", { p_document_id: id, p_reason: parsed.data.reason })
    .single();

  if (error) return rpcError("POST /api/documents/[id]/cancel", error, "Could not cancel this document");
  return apiOk(data);
}
