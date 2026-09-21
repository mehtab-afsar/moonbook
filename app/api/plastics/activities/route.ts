import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";
import { computeAmount, PricingError } from "@/lib/pricing";
import { toMinor, type CurrencyCode } from "@/lib/money";

export const runtime = "nodejs";

const COLUMNS =
  "id, party_id, bill_to_party_id, direction, occurred_on, currency, amount_minor, direct_cost_minor, material, grade, net_weight_kg, rate_per_kg_minor, ticket_no, vehicle_no, reference, notes, status, attachment_path, created_at";

export async function GET() {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);
  if (auth.ctx.vertical !== "plastics") return apiErr("Not available for this organisation", 403);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("plastics_activities")
    .select(`${COLUMNS}, parties!plastics_activities_party_org_fk(name)`)
    .order("occurred_on", { ascending: false })
    .limit(200);

  if (error) return apiErr("Could not load activities", 500);
  return apiOk(data);
}

const recordSchema = z.object({
  direction: z.enum(["receivable", "payable"]),
  party_id: z.uuid(),
  bill_to_party_id: z.uuid().optional().nullable(),
  occurred_on: z.iso.date(),
  material: z.string().trim().min(1).max(80),
  grade: z.enum(["A", "B", "C", "Mixed"]).optional().nullable(),
  net_weight_kg: z.number().positive(),
  /** Typed in major units, same as any `money` field — converted below. */
  rate_per_kg: z.number().min(0),
  ticket_no: z.string().trim().max(60).optional().nullable(),
  vehicle_no: z.string().trim().max(40).optional().nullable(),
  reference: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  direct_cost_minor: z.number().int().min(0).optional().nullable(),
});

/**
 * Amount is weight x rate, computed HERE by the same lib/pricing
 * quantity_rate strategy the shared engine uses — reused as pure
 * arithmetic, never re-derived per vertical.
 */
export async function POST(req: NextRequest) {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);
  if (auth.ctx.vertical !== "plastics") return apiErr("Not available for this organisation", 403);

  const parsed = await parseBody(req, recordSchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);
  const v = parsed.data;

  const supabase = await createClient();
  const { data: org, error: orgErr } = await supabase
    .from("organisations").select("base_currency").eq("id", auth.ctx.orgId).single();
  if (orgErr) return apiErr("Could not load your organisation", 500);

  let amountMinor: number;
  let ratePerKgMinor: number;
  try {
    const result = computeAmount({
      strategy: "quantity_rate",
      config: { quantity_field: "net_weight_kg", rate_field: "rate_per_kg" },
      details: { net_weight_kg: v.net_weight_kg, rate_per_kg: v.rate_per_kg },
      currency: org.base_currency,
      fields: [
        { key: "net_weight_kg", field_type: "number" },
        { key: "rate_per_kg", field_type: "money" },
      ],
    });
    amountMinor = result.amountMinor;
    ratePerKgMinor = toMinor(v.rate_per_kg, org.base_currency as CurrencyCode);
  } catch (err) {
    if (err instanceof PricingError) return apiErr(err.message, 422);
    throw err;
  }

  const { data, error } = await supabase
    .rpc("record_plastics_activity", {
      p_direction: v.direction,
      p_party_id: v.party_id,
      p_occurred_on: v.occurred_on,
      p_amount_minor: amountMinor,
      p_material: v.material,
      p_net_weight_kg: v.net_weight_kg,
      p_rate_per_kg_minor: ratePerKgMinor,
      p_bill_to_party_id: v.bill_to_party_id ?? undefined,
      p_grade: v.grade ?? undefined,
      p_ticket_no: v.ticket_no ?? undefined,
      p_vehicle_no: v.vehicle_no ?? undefined,
      p_reference: v.reference ?? undefined,
      p_notes: v.notes ?? undefined,
      p_direct_cost_minor: v.direct_cost_minor ?? undefined,
    })
    .single();

  if (error) return rpcError("POST /api/plastics/activities", error, "Could not record this");
  return apiOk({ ...data, amount_minor: amountMinor }, 201);
}
