import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOwner, verifyAuth } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";
import { PAYMENT_DIRECTIONS, PAYMENT_METHODS } from "@/lib/domain";

export const runtime = "nodejs";

export async function GET() {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payments")
    .select("id, direction, paid_on, method, reference_no, currency, amount_minor, parties!payments_party_id_fkey(name)")
    .order("paid_on", { ascending: false })
    .limit(200);

  if (error) return apiErr("Could not load payments", 500);
  return apiOk(data);
}

const paymentSchema = z.object({
  direction: z.enum(PAYMENT_DIRECTIONS).default("in"),
  party_id: z.uuid(),
  amount_minor: z.number().int().positive(),
  paid_on: z.iso.date(),
  method: z.enum(PAYMENT_METHODS),
  reference_no: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  /** Anything left unallocated stays visible as unapplied rather than forced. */
  allocations: z
    .array(z.object({ document_id: z.uuid(), amount_minor: z.number().int().positive() }))
    .default([]),
});

export async function POST(req: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const parsed = await parseBody(req, paymentSchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("record_payment", {
      p_direction: v.direction,
      p_party_id: v.party_id,
      p_amount_minor: v.amount_minor,
      p_paid_on: v.paid_on,
      p_method: v.method,
      p_allocations: v.allocations,
      p_reference_no: v.reference_no ?? undefined,
      p_notes: v.notes ?? undefined,
    })
    .single();

  if (error) return rpcError("POST /api/payments", error, "Could not record this payment");
  return apiOk(data, 201);
}
