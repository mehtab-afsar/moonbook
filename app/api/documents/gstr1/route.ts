import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { apiErr } from "@/lib/api/response";
import { buildGstr1B2b, type Gstr1SourceInvoice } from "@/lib/tax/gstr1";

export const runtime = "nodejs";

const periodSchema = z.string().regex(/^(0[1-9]|1[0-2])\d{4}$/, "period must be MMYYYY, e.g. 062026");

/**
 * GSTR-1's B2B section for one filing period — see lib/tax/gstr1.ts for what
 * this is and, deliberately, is not (no B2CS/B2CL, no signature, no upload).
 *
 * Gated to a split-rate (GST) organisation with its own GSTIN on file: the
 * shape this produces is meaningless for a VAT org or one with no tax_id —
 * there is nothing to file, so the honest response is "not applicable," not
 * an empty or wrong JSON file that looks like it worked.
 */
export async function GET(req: Request) {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const period = new URL(req.url).searchParams.get("period") ?? "";
  const parsed = periodSchema.safeParse(period);
  if (!parsed.success) return apiErr(parsed.error?.issues[0]?.message ?? "period must be MMYYYY", 422);

  const supabase = await createClient();

  const { data: org, error: orgErr } = await supabase
    .from("organisations")
    .select("tax_regime, tax_id")
    .eq("id", auth.ctx.orgId)
    .single();
  if (orgErr) return apiErr("Could not load your organisation", 500);
  if (org.tax_regime !== "split_rate") {
    return apiErr("GSTR-1 export only applies to a GST-registered business (split-rate tax regime)", 422);
  }
  if (!org.tax_id) {
    return apiErr("Add your GSTIN in Settings before exporting GSTR-1", 422);
  }

  const month = period.slice(0, 2);
  const year = period.slice(2);
  const from = `${year}-${month}-01`;
  const to = new Date(Number(year), Number(month), 1).toISOString().slice(0, 10); // first of the next month

  const { data: documents, error } = await supabase
    .from("documents")
    .select(
      "doc_no, doc_date, total_minor, parties!documents_counterparty_id_fkey(tax_id, region_code), document_taxes(component_code, rate_pct, amount_minor, taxable_value_minor)",
    )
    .eq("direction", "receivable")
    .eq("doc_kind", "invoice")
    .eq("status", "issued")
    .gte("doc_date", from)
    .lt("doc_date", to)
    .order("doc_date");

  if (error) return apiErr("Could not load invoices for that period", 500);

  // B2B only: an invoice with no counterparty GSTIN belongs in B2CS/B2CL,
  // which this endpoint does not build (see the file's own header) — left
  // out here rather than exported wrong.
  const invoices: Gstr1SourceInvoice[] = (documents ?? [])
    .map((d) => {
      const party = (d as unknown as { parties: { tax_id: string | null; region_code: string | null } | null }).parties;
      const taxes = (d as unknown as { document_taxes: { component_code: string; rate_pct: number; amount_minor: number; taxable_value_minor: number }[] }).document_taxes;
      if (!party?.tax_id || !d.doc_no) return null;
      return {
        doc_no: d.doc_no,
        doc_date: d.doc_date,
        total_minor: d.total_minor,
        counterparty_gstin: party.tax_id,
        counterparty_region_code: party.region_code,
        taxes,
      };
    })
    .filter((x): x is Gstr1SourceInvoice => x !== null);

  const gstr1 = buildGstr1B2b(org.tax_id, period, invoices);

  return new Response(JSON.stringify(gstr1, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="gstr1-b2b-${period}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
