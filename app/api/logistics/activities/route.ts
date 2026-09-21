import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";

export const runtime = "nodejs";

const COLUMNS =
  "id, party_id, bill_to_party_id, direction, occurred_on, currency, amount_minor, direct_cost_minor, origin, destination, vehicle_no, load_type, vendor_ref, reference, notes, status, attachment_path, created_at";

export async function GET() {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);
  if (auth.ctx.vertical !== "logistics") return apiErr("Not available for this organisation", 403);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("logistics_activities")
    .select(`${COLUMNS}, parties!logistics_activities_party_org_fk(name)`)
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
  amount_minor: z.number().int().min(0),
  direct_cost_minor: z.number().int().min(0).optional().nullable(),
  origin: z.string().trim().max(200).optional().nullable(),
  destination: z.string().trim().max(200).optional().nullable(),
  vehicle_no: z.string().trim().max(40).optional().nullable(),
  load_type: z.enum(["Full truckload", "Part load", "Express"]).optional().nullable(),
  vendor_ref: z.string().trim().max(100).optional().nullable(),
  reference: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);
  if (auth.ctx.vertical !== "logistics") return apiErr("Not available for this organisation", 403);

  const parsed = await parseBody(req, recordSchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("record_logistics_activity", {
      p_direction: v.direction,
      p_party_id: v.party_id,
      p_occurred_on: v.occurred_on,
      p_amount_minor: v.amount_minor,
      p_bill_to_party_id: v.bill_to_party_id ?? undefined,
      p_origin: v.origin ?? undefined,
      p_destination: v.destination ?? undefined,
      p_vehicle_no: v.vehicle_no ?? undefined,
      p_load_type: v.load_type ?? undefined,
      p_vendor_ref: v.vendor_ref ?? undefined,
      p_reference: v.reference ?? undefined,
      p_notes: v.notes ?? undefined,
      p_direct_cost_minor: v.direct_cost_minor ?? undefined,
    })
    .single();

  if (error) return rpcError("POST /api/logistics/activities", error, "Could not record this");
  return apiOk(data, 201);
}
