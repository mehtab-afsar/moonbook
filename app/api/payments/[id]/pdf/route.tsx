import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { apiErr } from "@/lib/api/response";
import { ReceiptPdf } from "@/lib/pdf/ReceiptPdf";
import { loadOrgLogoDataUri } from "@/lib/pdf/logo";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const { id } = await params;
  const supabase = await createClient();

  const { data: payment, error } = await supabase
    .from("payments")
    .select(
      "id, direction, paid_on, method, reference_no, currency, amount_minor, parties!payments_party_id_fkey(name, tax_id, tax_id_kind, address)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    log.error("GET /api/payments/[id]/pdf: query failed", { err: error.message, id });
    return apiErr("Could not load this payment", 500);
  }
  if (!payment) return apiErr("Payment not found", 404);

  const [{ data: org }, { data: allocations }] = await Promise.all([
    supabase.from("organisations").select("legal_name, tax_id, tax_id_kind, region_code, address, locale, base_currency, logo_path").eq("id", auth.ctx.orgId).single(),
    supabase
      .from("allocations")
      .select("amount_minor, documents!allocations_target_document_id_fkey(doc_no, doc_date, total_minor)")
      .eq("payment_id", id)
      .order("created_at"),
  ]);
  if (!org) return apiErr("Could not load your organisation", 500);

  const party = (payment as unknown as {
    parties: { name: string; tax_id: string | null; tax_id_kind: string | null; address: string | null } | null;
  }).parties;

  const applications = (allocations ?? [])
    .map((a) => {
      const doc = (a as unknown as { documents: { doc_no: string | null; doc_date: string; total_minor: number } | null }).documents;
      if (!doc) return null;
      return { doc_no: doc.doc_no ?? "—", doc_date: doc.doc_date, doc_total_minor: doc.total_minor, amount_minor: a.amount_minor };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

  const logoDataUri = await loadOrgLogoDataUri(supabase, org.logo_path);

  let buffer: Buffer;
  try {
    buffer = await renderToBuffer(
      <ReceiptPdf
        logoDataUri={logoDataUri}
        snapshot={{
          id: payment.id,
          direction: payment.direction as "in" | "out",
          paid_on: payment.paid_on,
          method: payment.method,
          reference_no: payment.reference_no,
          currency: payment.currency,
          amount_minor: payment.amount_minor,
          party: party ?? { name: "—", tax_id: null, tax_id_kind: null, address: null },
          applications,
          organisation: org,
        }}
      />,
    );
  } catch (err) {
    log.error("GET /api/payments/[id]/pdf: render failed", {
      err: err instanceof Error ? err.message : String(err),
      id,
    });
    return apiErr("Could not render this receipt", 500);
  }

  const filename = `receipt-${payment.id.slice(0, 8)}.pdf`;
  const download = new URL(req.url).searchParams.get("download") === "1";

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
