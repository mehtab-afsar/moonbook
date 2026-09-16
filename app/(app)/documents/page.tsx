import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { formatMoney } from "@/lib/money";
import { attachBalances, settlementLabel } from "@/lib/documents/with-balances";
import { buttonPrimaryClass } from "@/lib/ui/styles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documents" };

const TONE: Record<string, string> = {
  settled: "bg-settled-tint text-settled-ink",
  pending: "bg-pending-tint text-pending-ink",
  overdue: "bg-overdue-tint text-overdue",
  muted: "bg-line-soft text-ink-2",
};

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
    supabase.from("organisations").select("locale").eq("id", auth.ctx.orgId).single(),
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
    <div className="space-y-6 p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Documents</h1>
          <p className="mt-1 text-[13.5px] text-ink-2">
            Invoices and credit notes. Every balance is computed on read from payments and
            offsets — nothing here is a stored total that can drift.
          </p>
        </div>
        <Link href="/documents/new" className={buttonPrimaryClass}>
          Issue an invoice
        </Link>
      </header>

      <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-line-soft text-[12px] uppercase tracking-wide text-ink-3">
              <th className="px-5 py-3 font-medium">Number</th>
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Party</th>
              <th className="px-5 py-3 font-medium">Total</th>
              <th className="px-5 py-3 font-medium">Due</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-ink-3">
                  Nothing issued yet. Record some work first, then bill it.
                </td>
              </tr>
            )}
            {rows.map((d) => {
              const party = (d as unknown as { parties: { name: string } | null }).parties;
              const state = settlementLabel(d.balance, d.status);
              const overdue =
                d.balance !== null &&
                d.balance.balance_due_minor > 0 &&
                d.due_date !== null &&
                d.due_date < today;
              const tone = overdue ? "overdue" : state.tone;

              return (
                <tr key={d.id} className="border-b border-line-soft last:border-b-0 hover:bg-paper">
                  <td className="px-5 py-3">
                    <Link href={`/documents/${d.id}`} className="font-mono font-medium text-brand hover:underline">
                      {d.doc_no ?? d.party_doc_no ?? "—"}
                    </Link>
                    <span className="ml-2 text-[12px] text-ink-3">{KIND_LABEL[d.doc_kind] ?? d.doc_kind}</span>
                  </td>
                  <td className="px-5 py-3 font-mono text-ink-2">{d.doc_date}</td>
                  <td className="px-5 py-3 font-medium text-ink">{party?.name ?? "—"}</td>
                  <td className="px-5 py-3 font-mono text-ink">
                    {formatMoney(d.total_minor, d.currency, locale)}
                  </td>
                  <td className="px-5 py-3 font-mono">
                    {d.balance === null ? (
                      <span className="text-ink-3">—</span>
                    ) : d.balance.balance_due_minor <= 0 ? (
                      <span className="text-ink-3">—</span>
                    ) : (
                      <span className={overdue ? "text-overdue" : "text-ink"}>
                        {formatMoney(d.balance.balance_due_minor, d.currency, locale)}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${TONE[tone]}`}>
                      {overdue ? "Overdue" : state.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
