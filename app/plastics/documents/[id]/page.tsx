import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { formatMoney } from "@/lib/money";
import { attachPlasticsBalances } from "@/lib/plastics/with-balances";
import { settlementLabel } from "@/lib/documents/with-balances";
import { RecordPaymentForm } from "@/features/plastics/components/RecordPaymentForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Document" };

const TONE: Record<string, string> = {
  settled: "bg-settled-tint text-settled-ink",
  pending: "bg-pending-tint text-pending-ink",
  overdue: "bg-overdue-tint text-overdue",
  muted: "bg-line-soft text-ink-2",
};

export default async function PlasticsDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");
  if (auth.ctx.vertical !== "plastics") redirect("/dashboard");

  const { id } = await params;
  const supabase = await createClient();

  const { data: doc, error } = await supabase
    .from("plastics_documents")
    .select("id, doc_kind, doc_no, party_doc_no, doc_date, due_date, status, currency, direction, counterparty_id, taxable_value_minor, total_minor, notes, parties!plastics_documents_counterparty_org_fk(name)")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load this document: ${error.message}`);
  if (!doc) notFound();

  const [{ data: org }, withBalance, { data: lines }, { data: taxes }, { data: allocations }] = await Promise.all([
    supabase.from("organisations").select("locale, timezone").eq("id", auth.ctx.orgId).single(),
    attachPlasticsBalances(supabase, [doc]),
    supabase.from("plastics_document_lines").select("description, amount_minor, sort_order").eq("document_id", id).order("sort_order"),
    supabase.from("plastics_document_taxes").select("component_label, amount_minor").eq("document_id", id),
    supabase
      .from("plastics_allocations")
      .select("id, amount_minor, created_at, plastics_payments(paid_on, method, reference_no)")
      .eq("target_document_id", id)
      .order("created_at"),
  ]);

  const balance = withBalance[0]?.balance ?? null;
  const locale = org?.locale ?? "en";
  const state = settlementLabel(balance, doc.status);
  const money = (minor: number) => formatMoney(minor, doc.currency, locale);
  const party = (doc as unknown as { parties: { name: string } | null }).parties;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: org?.timezone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const overdue = balance !== null && balance.balance_due_minor > 0 && doc.due_date !== null && doc.due_date < today;

  return (
    <div className="max-w-[900px] space-y-6 p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/plastics/documents" className="text-[13px] text-ink-2 hover:text-ink">← Documents</Link>
          <h1 className="mt-2 font-mono text-[22px] font-semibold tracking-[-0.01em] text-ink">{doc.doc_no ?? doc.party_doc_no ?? "—"}</h1>
          <p className="mt-1 text-[13.5px] text-ink-2">{party?.name ?? "—"} · {doc.doc_date}{doc.due_date && <> · due {doc.due_date}</>}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${TONE[overdue ? "overdue" : state.tone]}`}>
          {overdue ? "Overdue" : state.label}
        </span>
      </header>

      <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-line-soft text-[12px] uppercase tracking-wide text-ink-3">
              <th className="px-5 py-3 font-medium">Description</th>
              <th className="px-5 py-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(lines ?? []).map((l, i) => (
              <tr key={i} className="border-b border-line-soft last:border-b-0">
                <td className="px-5 py-3 text-ink">{l.description}</td>
                <td className="px-5 py-3 text-right font-mono text-ink">{money(l.amount_minor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-line px-5 py-4">
          <dl className="ml-auto max-w-[280px] space-y-1.5 text-[13.5px]">
            <div className="flex justify-between"><dt className="text-ink-2">Taxable value</dt><dd className="font-mono text-ink">{money(doc.taxable_value_minor)}</dd></div>
            {(taxes ?? []).map((t, i) => (
              <div key={i} className="flex justify-between"><dt className="text-ink-2">{t.component_label}</dt><dd className="font-mono text-ink">{money(t.amount_minor)}</dd></div>
            ))}
            <div className="flex justify-between border-t border-line pt-1.5"><dt className="font-medium text-ink">Total</dt><dd className="font-mono font-semibold text-ink">{money(doc.total_minor)}</dd></div>
            {balance && balance.balance_due_minor !== doc.total_minor && (
              <div className="flex justify-between"><dt className="text-ink-2">Outstanding</dt><dd className={`font-mono ${overdue ? "text-overdue" : "text-ink"}`}>{money(balance.balance_due_minor)}</dd></div>
            )}
          </dl>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-[15px] font-medium text-ink">Payments</h2>
        {(allocations ?? []).length === 0 ? (
          <p className="text-[13.5px] text-ink-3">
            {doc.direction === "payable" ? "Nothing paid against this yet." : "Nothing received against this yet."}
          </p>
        ) : (
          <ul className="divide-y divide-line-soft rounded-[10px] border border-line bg-white">
            {(allocations ?? []).map((a) => {
              const p = (a as unknown as { plastics_payments: { paid_on: string; method: string; reference_no: string | null } | null }).plastics_payments;
              return (
                <li key={a.id} className="flex items-baseline justify-between p-3.5 text-[13.5px]">
                  <span className="text-ink-2">{p ? `${p.paid_on} · ${p.method}` : "—"}{p?.reference_no && <span className="ml-2 font-mono text-ink-3">{p.reference_no}</span>}</span>
                  <span className="font-mono text-ink">{money(a.amount_minor)}</span>
                </li>
              );
            })}
          </ul>
        )}

        {auth.ctx.role === "owner" && doc.status === "issued" && balance !== null && balance.balance_due_minor > 0 && (
          <RecordPaymentForm
            documentId={doc.id} partyId={doc.counterparty_id} balanceMinor={balance.balance_due_minor}
            currency={doc.currency} locale={locale} today={today}
            direction={doc.direction as "receivable" | "payable"}
          />
        )}
      </section>
    </div>
  );
}
