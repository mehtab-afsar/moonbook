import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";

export const runtime = "nodejs";

const COLUMNS =
  "id, category, description, currency, amount_minor, incurred_on, party_id, created_at";

export async function GET() {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .select(`${COLUMNS}, parties(name)`)
    .order("incurred_on", { ascending: false })
    .limit(200);

  if (error) return apiErr("Could not load expenses", 500);
  return apiOk(data);
}

const expenseSchema = z.object({
  category: z.string().trim().min(2, "a category is required").max(80),
  description: z.string().trim().max(500).optional().nullable(),
  amount_minor: z.number().int().positive(),
  incurred_on: z.iso.date(),
  party_id: z.uuid().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const parsed = await parseBody(req, expenseSchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);
  const v = parsed.data;

  const supabase = await createClient();

  // Currency is the organisation's own, never client-supplied — the same
  // rule every other money-bearing table follows.
  const { data: org, error: orgErr } = await supabase
    .from("organisations").select("base_currency").eq("id", auth.ctx.orgId).single();
  if (orgErr) return apiErr("Could not load your organisation", 500);

  // A direct insert, not an RPC: expenses carry no sequence, no state machine
  // and no cross-table invariant beyond the party/org FK the schema already
  // enforces — the RLS `with check` is the whole rule, same as parties.
  const { data, error } = await supabase
    .from("expenses")
    .insert({
      category: v.category,
      description: v.description || null,
      amount_minor: v.amount_minor,
      incurred_on: v.incurred_on,
      party_id: v.party_id || null,
      currency: org.base_currency,
      org_id: auth.ctx.orgId,
      created_by: auth.ctx.userId,
    })
    .select(COLUMNS)
    .single();

  if (error) return rpcError("POST /api/expenses", error, "Could not record this expense");
  return apiOk(data, 201);
}
