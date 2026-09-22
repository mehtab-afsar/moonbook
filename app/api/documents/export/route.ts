import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { apiErr } from "@/lib/api/response";
import { attachBalances } from "@/lib/documents/with-balances";
import { fromMinor, type CurrencyCode } from "@/lib/money";
import { toCsv, csvResponse } from "@/lib/export/csv";

export const runtime = "nodejs";

const COLUMNS = [
  { key: "doc_no", label: "Document no." },
  { key: "doc_kind", label: "Kind" },
  { key: "doc_date", label: "Date" },
  { key: "due_date", label: "Due date" },
  { key: "party_name", label: "Party" },
  { key: "status", label: "Status" },
  { key: "currency", label: "Currency" },
  { key: "total", label: "Total" },
  { key: "settled", label: "Paid" },
  { key: "balance_due", label: "Balance due" },
] as const;

/**
 * Every document, one CSV — the same figures the list page and the PDFs
 * already show, just flattened for a spreadsheet instead of a browser.
 * No row cap: unlike the list page's `.limit(200)` (built for scrolling), an
 * export exists specifically so nothing is left out of it.
 */
export async function GET() {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const supabase = await createClient();
  const { data: documents, error } = await supabase
    .from("documents")
    .select(
      "id, doc_kind, doc_no, party_doc_no, doc_date, due_date, status, currency, total_minor, parties!documents_counterparty_id_fkey(name)",
    )
    .order("doc_date", { ascending: false })
    .order("doc_no", { ascending: false });

  if (error) return apiErr("Could not load documents", 500);

  const rows = await attachBalances(supabase, documents ?? []);

  const csv = toCsv(
    COLUMNS,
    rows.map((d) => {
      const currency = d.currency as CurrencyCode;
      const party = (d as unknown as { parties: { name: string } | null }).parties;
      return {
        doc_no: d.doc_no ?? d.party_doc_no ?? "",
        doc_kind: d.doc_kind,
        doc_date: d.doc_date,
        due_date: d.due_date ?? "",
        party_name: party?.name ?? "",
        status: d.status,
        currency: d.currency,
        // The view only covers invoices/bills (see document_balances' own
        // comment) — a credit/debit note or a draft has no `d.balance` row,
        // so its own total_minor is the fallback rather than a false zero.
        total: fromMinor(d.balance?.total_minor ?? d.total_minor, currency),
        settled: fromMinor(d.balance?.settled_minor ?? 0, currency),
        balance_due: fromMinor(d.balance?.balance_due_minor ?? d.total_minor, currency),
      };
    }),
  );

  return csvResponse(csv, "documents.csv");
}
