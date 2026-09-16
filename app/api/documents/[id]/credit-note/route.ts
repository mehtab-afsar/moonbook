import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";
import { computeTax, type TaxRegime, type TaxTreatment } from "@/lib/tax";

export const runtime = "nodejs";

/**
 * Crediting a document that was wrong.
 *
 * The caller names a TAXABLE VALUE, not a total. Tax is then computed here by
 * the same lib/tax call that issued the original, using the organisation's
 * regime and the counterparty's region — so a credit note carries the same
 * shape of tax the invoice did, and a browser still cannot name its own tax.
 *
 * The treatment is taken from the document being credited rather than asked
 * for: crediting an exempt supply with tax on it would be a new error, not a
 * correction of the old one.
 */
const creditSchema = z.object({
  taxable_value_minor: z.number().int().positive(),
  reason: z.string().trim().min(3, "a reason is required").max(500),
  doc_date: z.iso.date().optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const { id } = await params;
  const parsed = await parseBody(req, creditSchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);
  const v = parsed.data;

  const supabase = await createClient();

  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id, doc_kind, status, tax_treatment, counterparty_id, total_minor")
    .eq("id", id)
    .maybeSingle();

  if (docErr) return apiErr("Could not load this document", 500);
  if (!doc) return apiErr("Document not found", 404);
  if (doc.status !== "issued") {
    return apiErr("Only an issued document can be credited", 409);
  }

  const [{ data: org, error: orgErr }, { data: party, error: partyErr }] = await Promise.all([
    supabase
      .from("organisations")
      .select("region_code, tax_regime, default_tax_rate_pct")
      .eq("id", auth.ctx.orgId)
      .single(),
    supabase.from("parties").select("region_code").eq("id", doc.counterparty_id).maybeSingle(),
  ]);
  if (orgErr) return apiErr("Could not load your organisation", 500);
  if (partyErr || !party) return apiErr("Could not load that party", 500);

  const tax = computeTax({
    regime: org.tax_regime as TaxRegime,
    treatment: doc.tax_treatment as TaxTreatment,
    taxableValueMinor: v.taxable_value_minor,
    ratePct: Number(org.default_tax_rate_pct),
    supplierRegion: org.region_code,
    placeOfSupplyRegion: party.region_code,
  });

  const { data, error } = await supabase
    .rpc("issue_credit_note", {
      p_document_id: id,
      p_taxable_value_minor: v.taxable_value_minor,
      p_total_minor: tax.totalMinor,
      p_reason: v.reason,
      p_taxes: tax.components,
      p_doc_date: v.doc_date ?? undefined,
      p_notes: v.notes ?? undefined,
    })
    .single();

  if (error) return rpcError("POST /api/documents/[id]/credit-note", error, "Could not raise this credit note");
  return apiOk({ ...data, total_minor: tax.totalMinor }, 201);
}
