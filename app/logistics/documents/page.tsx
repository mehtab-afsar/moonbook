import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { attachLogisticsBalances } from "@/lib/logistics/with-balances";
import { buttonPrimaryClass, buttonSecondaryClass } from "@/lib/ui/styles";
import { DocumentsTable, type DocumentRow } from "@/features/documents/components/DocumentsTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoices" };

const KIND_LABEL: Record<string, string> = { invoice: "Invoice", bill: "Bill" };

export default async function LogisticsDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");
  if (auth.ctx.vertical !== "logistics") redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: org }, { data: documents, error }] = await Promise.all([
    supabase.from("organisations").select("locale").eq("id", auth.ctx.orgId).single(),
    supabase
      .from("logistics_documents")
      .select("id, doc_kind, doc_no, party_doc_no, doc_date, due_date, status, currency, total_minor, parties!logistics_documents_counterparty_org_fk(name)")
      .order("doc_date", { ascending: false })
      .order("doc_no", { ascending: false })
      .limit(200),
  ]);

  if (error) throw new Error(`Could not load documents: ${error.message}`);

  const locale = org?.locale ?? "en";
  const rows = await attachLogisticsBalances(supabase, documents ?? []);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Invoices</h1>
          <p className="mt-1 text-[13.5px] text-ink-2">Invoices and bills, computed on read.</p>
        </div>
        <div className="flex gap-3">
          <a href="/api/logistics/documents/export" className={buttonSecondaryClass}>Export CSV</a>
          <Link href="/logistics/documents/new" className={buttonPrimaryClass}>Issue an invoice or pay a vendor</Link>
        </div>
      </header>

      <DocumentsTable
        rows={rows.map((d) => ({
          ...d,
          party_name: (d as unknown as { parties: { name: string } | null }).parties?.name ?? null,
        })) as DocumentRow[]}
        locale={locale}
        today={today}
        hrefPrefix="/logistics/documents"
        kindLabel={KIND_LABEL}
        emptyLabel="Nothing issued yet."
        initialFilter={filter === "outstanding" || filter === "overdue" ? filter : "all"}
        pdfHrefPrefix="/api/logistics/documents"
      />
    </div>
  );
}
