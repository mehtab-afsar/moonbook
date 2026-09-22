import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOwner, verifyAuth } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";
import { addMinor, lineAmountMinor } from "@/lib/money";
import { computeTaxGrouped, type TaxRegime, type TaxTreatment } from "@/lib/tax";
import { BILLABLE_DOC_KINDS, TAX_TREATMENTS } from "@/lib/domain";

export const runtime = "nodejs";

export async function GET() {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    // The FK is named: documents reaches parties by two keys
    // (counterparty_id and ship_to_party_id), and an ambiguous embed errors.
    .select(
      "id, direction, doc_kind, doc_no, party_doc_no, doc_date, due_date, status, currency, total_minor, parties!documents_counterparty_id_fkey(name)",
    )
    .order("doc_date", { ascending: false })
    .limit(200);

  if (error) return apiErr("Could not load documents", 500);
  return apiOk(data);
}

const issueSchema = z.object({
  // Only the two BILLABLE kinds. A credit or debit note is not raised
  // here — it offsets an existing document, and issue_credit_note is the
  // path that knows how to point it at one.
  doc_kind: z.enum(BILLABLE_DOC_KINDS).default("invoice"),
  counterparty_id: z.uuid(),
  doc_date: z.iso.date(),
  due_date: z.iso.date().optional().nullable(),
  activity_ids: z.array(z.uuid()).default([]),
  free_lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(300),
        hsn_sac: z.string().trim().max(20).optional().nullable(),
        quantity: z.number().optional().nullable(),
        unit: z.string().trim().max(30).optional().nullable(),
        rate_minor: z.number().int().optional().nullable(),
        discount_minor: z.number().int().min(0).default(0),
        amount_minor: z.number().int().min(0),
        /** This line's own rate. Null/omitted means the document default. */
        tax_rate_pct: z.number().min(0).max(100).optional().nullable(),
      }),
    )
    .default([]),
  tax_treatment: z.enum(TAX_TREATMENTS).default("forward"),
  /** Overrides the organisation's default rate for this one document. */
  tax_rate_pct: z.number().min(0).max(100).optional(),
  ship_to_party_id: z.uuid().optional().nullable(),
  counterparty_override_reason: z.string().trim().max(500).optional().nullable(),
  party_doc_no: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

/**
 * Tax is computed HERE, in lib/tax, from the organisation's regime and the
 * two regions — never sent by the client and never recomputed in SQL. The RPC
 * stores the breakdown it is handed, so the two can never drift, and a client
 * cannot name its own tax.
 *
 * The taxable value likewise comes from the activities as recorded, not from
 * anything the browser said they were worth.
 */
export async function POST(req: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const parsed = await parseBody(req, issueSchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);
  const v = parsed.data;

  if (v.activity_ids.length === 0 && v.free_lines.length === 0) {
    return apiErr("Add at least one item to this document", 422);
  }

  // A free line's amount is derived server-side from rate × qty whenever both
  // are given, never trusted as the bare figure the client sent — see
  // lineAmountMinor's doc comment. A line with no rate/qty breakdown (a lump
  // sum with just a description) is left as the client's own amount_minor.
  const freeLines: typeof v.free_lines = [];
  for (const line of v.free_lines) {
    if (line.rate_minor == null || line.quantity == null) {
      freeLines.push(line);
      continue;
    }
    const amount_minor = lineAmountMinor(line.rate_minor, line.quantity, line.discount_minor);
    if (amount_minor < 0) {
      return apiErr(`"${line.description}": discount cannot exceed rate × quantity`, 422);
    }
    freeLines.push({ ...line, amount_minor });
  }

  const supabase = await createClient();

  const [{ data: org, error: orgErr }, { data: party, error: partyErr }] = await Promise.all([
    supabase
      .from("organisations")
      .select("region_code, tax_regime, default_tax_rate_pct")
      .eq("id", auth.ctx.orgId)
      .single(),
    supabase.from("parties").select("id, region_code").eq("id", v.counterparty_id).maybeSingle(),
  ]);
  if (orgErr) return apiErr("Could not load your organisation", 500);
  if (partyErr) return apiErr("Could not load that party", 500);
  if (!party) return apiErr("Party not found", 404);

  // Each line's own rate, or the document/org default when it has none —
  // this is what lets a wholesale delivery mix 5% oil and 18% groceries on
  // one invoice: grouped by rate below, not charged one rate for everything.
  const defaultRatePct = v.tax_rate_pct ?? Number(org.default_tax_rate_pct);
  const rateGroups: { taxableValueMinor: number; ratePct: number }[] = [];

  let taxableValueMinor = 0;
  if (v.activity_ids.length > 0) {
    const { data: activities, error: actErr } = await supabase
      .from("activities")
      .select("id, amount_minor, tax_rate_pct")
      .in("id", v.activity_ids);
    if (actErr) return apiErr("Could not load those activities", 500);
    if ((activities ?? []).length !== v.activity_ids.length) {
      return apiErr("One or more of those activities could not be found", 404);
    }
    for (const a of activities ?? []) {
      rateGroups.push({ taxableValueMinor: a.amount_minor, ratePct: a.tax_rate_pct ?? defaultRatePct });
    }
    taxableValueMinor = addMinor(...(activities ?? []).map((a) => a.amount_minor));
  }
  for (const l of freeLines) {
    rateGroups.push({ taxableValueMinor: l.amount_minor, ratePct: l.tax_rate_pct ?? defaultRatePct });
  }
  taxableValueMinor = addMinor(taxableValueMinor, ...freeLines.map((l) => l.amount_minor));

  const tax = computeTaxGrouped(rateGroups, {
    regime: org.tax_regime as TaxRegime,
    treatment: v.tax_treatment as TaxTreatment,
    supplierRegion: org.region_code,
    placeOfSupplyRegion: party.region_code,
  });

  const { data, error } = await supabase
    .rpc("issue_document", {
      p_doc_kind: v.doc_kind,
      p_counterparty_id: v.counterparty_id,
      p_doc_date: v.doc_date,
      p_taxable_value_minor: taxableValueMinor,
      p_total_minor: tax.totalMinor,
      p_taxes: tax.components,
      p_activity_ids: v.activity_ids,
      p_free_lines: freeLines,
      p_tax_treatment: v.tax_treatment,
      p_due_date: v.due_date ?? undefined,
      p_ship_to_party_id: v.ship_to_party_id ?? undefined,
      p_counterparty_override_reason: v.counterparty_override_reason ?? undefined,
      p_party_doc_no: v.party_doc_no ?? undefined,
      p_notes: v.notes ?? undefined,
    })
    .single();

  if (error) return rpcError("POST /api/documents", error, "Could not issue this document");
  return apiOk({ ...data, total_minor: tax.totalMinor, tax_note: tax.note }, 201);
}
