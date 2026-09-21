import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOwner, verifyAuth } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";
import { addMinor } from "@/lib/money";
import { computeTax, type TaxRegime, type TaxTreatment } from "@/lib/tax";

export const runtime = "nodejs";

export async function GET() {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);
  if (auth.ctx.vertical !== "logistics") return apiErr("Not available for this organisation", 403);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("logistics_documents")
    .select(
      "id, direction, doc_kind, doc_no, party_doc_no, doc_date, due_date, status, currency, total_minor, parties!logistics_documents_counterparty_org_fk(name)",
    )
    .order("doc_date", { ascending: false })
    .limit(200);

  if (error) return apiErr("Could not load documents", 500);
  return apiOk(data);
}

const issueSchema = z.object({
  doc_kind: z.enum(["invoice", "bill"]).default("invoice"),
  counterparty_id: z.uuid(),
  doc_date: z.iso.date(),
  due_date: z.iso.date().optional().nullable(),
  activity_ids: z.array(z.uuid()).default([]),
  tax_treatment: z.enum(["forward", "reverse_charge", "exempt"]).default("forward"),
  tax_rate_pct: z.number().min(0).max(100).optional(),
  party_doc_no: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

/** Tax computed here, same rule and same lib/tax the shared engine uses — a
 *  client can no more name its own logistics tax than its shared-ledger one. */
export async function POST(req: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);
  if (auth.ctx.vertical !== "logistics") return apiErr("Not available for this organisation", 403);

  const parsed = await parseBody(req, issueSchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);
  const v = parsed.data;

  if (v.activity_ids.length === 0) return apiErr("Add at least one item to this document", 422);

  const supabase = await createClient();
  const [{ data: org, error: orgErr }, { data: party, error: partyErr }] = await Promise.all([
    supabase.from("organisations").select("region_code, tax_regime, default_tax_rate_pct").eq("id", auth.ctx.orgId).single(),
    supabase.from("parties").select("id, region_code").eq("id", v.counterparty_id).maybeSingle(),
  ]);
  if (orgErr) return apiErr("Could not load your organisation", 500);
  if (partyErr) return apiErr("Could not load that party", 500);
  if (!party) return apiErr("Party not found", 404);

  const { data: activities, error: actErr } = await supabase
    .from("logistics_activities")
    .select("id, amount_minor")
    .in("id", v.activity_ids);
  if (actErr) return apiErr("Could not load those activities", 500);
  if ((activities ?? []).length !== v.activity_ids.length) {
    return apiErr("One or more of those activities could not be found", 404);
  }
  const taxableValueMinor = addMinor(...(activities ?? []).map((a) => a.amount_minor));

  const tax = computeTax({
    regime: org.tax_regime as TaxRegime,
    treatment: v.tax_treatment as TaxTreatment,
    taxableValueMinor,
    ratePct: v.tax_rate_pct ?? Number(org.default_tax_rate_pct),
    supplierRegion: org.region_code,
    placeOfSupplyRegion: party.region_code,
  });

  const { data, error } = await supabase
    .rpc("issue_logistics_document", {
      p_doc_kind: v.doc_kind,
      p_counterparty_id: v.counterparty_id,
      p_doc_date: v.doc_date,
      p_taxable_value_minor: taxableValueMinor,
      p_total_minor: tax.totalMinor,
      p_taxes: tax.components,
      p_activity_ids: v.activity_ids,
      p_tax_treatment: v.tax_treatment,
      p_due_date: v.due_date ?? undefined,
      p_party_doc_no: v.party_doc_no ?? undefined,
      p_notes: v.notes ?? undefined,
    })
    .single();

  if (error) return rpcError("POST /api/logistics/documents", error, "Could not issue this document");
  return apiOk({ ...data, total_minor: tax.totalMinor, tax_note: tax.note }, 201);
}
