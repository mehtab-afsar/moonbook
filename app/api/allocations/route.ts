import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";

export const runtime = "nodejs";

/**
 * Applying money that is already in the book.
 *
 * Until this route existed, allocation only happened at the moment a receipt
 * was recorded — so money taken on account, or a credit note raised later,
 * could never be put against a subsequent invoice through the product. The
 * payments screen would show an unapplied balance with no way to spend it.
 *
 * `allocate()` does the work: it locks the target document, refuses to exceed
 * what that document still owes, and refuses to exceed what remains unapplied
 * on the payment or note. Exactly one source, enforced by a check constraint.
 */
const allocationSchema = z
  .object({
    target_document_id: z.uuid(),
    amount_minor: z.number().int().positive(),
    payment_id: z.uuid().optional().nullable(),
    credit_document_id: z.uuid().optional().nullable(),
  })
  .refine(
    (v) => (v.payment_id ? 1 : 0) + (v.credit_document_id ? 1 : 0) === 1,
    "supply exactly one of a payment or a credit note",
  );

export async function POST(req: NextRequest) {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const parsed = await parseBody(req, allocationSchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("allocate", {
      p_target_document_id: v.target_document_id,
      p_amount_minor: v.amount_minor,
      p_payment_id: v.payment_id ?? undefined,
      p_credit_document_id: v.credit_document_id ?? undefined,
    })
    .single();

  if (error) return rpcError("POST /api/allocations", error, "Could not apply this amount");
  return apiOk(data, 201);
}
