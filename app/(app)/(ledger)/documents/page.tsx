import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { attachBalances } from "@/lib/documents/with-balances";
import { buttonPrimaryClass, buttonSecondaryClass } from "@/lib/ui/styles";
import { DocumentsTable, type DocumentRow } from "@/features/documents/components/DocumentsTable";
import { Gstr1ExportButton } from "@/features/documents/components/Gstr1ExportButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documents" };

const KIND_LABEL: Record<string, string> = {
  invoice: "Invoice",
  bill: "Bill",
  credit_note: "Credit note",
  debit_note: "Debit note",
};

export default async function DocumentsPage() {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");

  const supabase = await createClient();
  const [{ data: org }, { data: documents, error }] = await Promise.all([
    supabase.from("organisations").select("locale, tax_regime, tax_id").eq("id", auth.ctx.orgId).single(),
    supabase
      .from("documents")
      // The embed names its key: documents reaches parties by both
      // counterparty_id and ship_to_party_id, and an ambiguous embed is a
      // PostgREST error rather than a guess.
      .select(
        "id, doc_kind, doc_no, party_doc_no, doc_date, due_date, status, currency, total_minor, parties!documents_counterparty_id_fkey(name)",
      )
      .order("doc_date", { ascending: false })
      .order("doc_no", { ascending: false })
      .limit(200),
  ]);

  if (error) throw new Error(`Could not load documents: ${error.message}`);

  const locale = org?.locale ?? "en";
  const rows = await attachBalances(supabase, documents ?? []);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Documents</h1>
          <p className="mt-1 text-[13.5px] text-ink-2">
            Invoices and credit notes. Every balance is computed on read from payments and
            offsets — nothing here is a stored total that can drift.
          </p>
        </div>
        <div className="flex gap-3">
          <a href="/api/documents/export" className={buttonSecondaryClass}>
            Export CSV
          </a>
          {org?.tax_regime === "split_rate" && org?.tax_id && <Gstr1ExportButton />}
          <Link href="/documents/new/bill" className={buttonSecondaryClass}>
            Record a bill
          </Link>
          <Link href="/documents/new" className={buttonPrimaryClass}>
            Issue an invoice
          </Link>
        </div>
      </header>

      <DocumentsTable
        rows={rows.map((d) => ({
          ...d,
          party_name: (d as unknown as { parties: { name: string } | null }).parties?.name ?? null,
        })) as DocumentRow[]}
        locale={locale}
        today={today}
        hrefPrefix="/documents"
        kindLabel={KIND_LABEL}
        emptyLabel="Nothing issued yet. Record some work first, then bill it."
        pdfHrefPrefix="/api/documents"
      />
    </div>
  );
}
