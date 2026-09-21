import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { formatMoney } from "@/lib/money";
import { attachBalances, settlementLabel } from "@/lib/documents/with-balances";
import { parseSnapshot } from "@/lib/pdf/snapshot";
import { RecordPaymentForm } from "@/features/documents/components/RecordPaymentForm";
import { DocumentActions, type HeldCredit } from "@/features/documents/components/DocumentActions";
import { buttonSecondaryClass } from "@/lib/ui/styles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Document" };

const TONE: Record<string, string> = {
  settled: "bg-settled-tint text-settled-ink",
  pending: "bg-pending-tint text-pending-ink",
  overdue: "bg-overdue-tint text-overdue",
  muted: "bg-line-soft text-ink-2",
};

/**
 * The document exactly as it was issued.
 *
 * Everything on this page is read from `issued_snapshot`, not from live
 * tables — the same source the PDF renders from, so what is on screen and what
 * is in the customer's inbox can never disagree. The only live figures are the
 * balance and the payments against it, which are supposed to change.
 */
export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");

  const { id } = await params;
  const supabase = await createClient();

  const { data: doc, error } = await supabase
    .from("documents")
    .select("id, doc_kind, doc_no, party_doc_no, doc_date, due_date, status, currency, direction, counterparty_id, issued_snapshot")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load this document: ${error.message}`);
  // RLS returned nothing, which for another tenant's document is a 404 and
  // never a 403 — a 403 would confirm it exists.
  if (!doc) notFound();

  const [{ data: org }, withBalance, { data: allocations }, { data: openPayments }, { data: openCredits }] =
    await Promise.all([
      supabase.from("organisations").select("locale, timezone").eq("id", auth.ctx.orgId).single(),
      attachBalances(supabase, [doc]),
      supabase
        .from("allocations")
        .select("id, amount_minor, created_at, payments!allocations_payment_id_fkey(paid_on, method, reference_no)")
        .eq("target_document_id", id)
        .order("created_at"),
      // Money in the book with somewhere left to go. Both are views, so both
      // are fetched separately rather than embedded — see CONVENTIONS.md §9.
      supabase
        .from("payment_balances")
        .select("payment_id, party_id, direction, paid_on, unapplied_minor")
        .eq("party_id", doc.counterparty_id)
        // A receivable document (invoice) can only ever be settled by 'in'
        // money; a payable one (bill) only ever by 'out' money — allocate()
        // enforces this too, but offering the wrong kind here would just be
        // a confusing dead end.
        .eq("direction", doc.direction === "receivable" ? "in" : "out")
        .gt("unapplied_minor", 0)
        .order("paid_on"),
      supabase
        .from("credit_balances")
        .select("document_id, counterparty_id, doc_no, direction, unapplied_minor")
        .eq("counterparty_id", doc.counterparty_id)
        .eq("direction", doc.direction)
        .gt("unapplied_minor", 0)
        // credit_balances carries no date — the number is issued in date
        // order within a series, so it sorts the same way.
        .order("doc_no"),
    ]);

  const balance = withBalance[0]?.balance ?? null;
  const locale = org?.locale ?? "en";
  const state = settlementLabel(balance, doc.status);
  const money = (minor: number) => formatMoney(minor, doc.currency, locale);

  const snapshot = doc.issued_snapshot ? parseSnapshot(doc.issued_snapshot) : null;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: org?.timezone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  const overdue =
    balance !== null && balance.balance_due_minor > 0 && doc.due_date !== null && doc.due_date < today;

  // What this customer has already paid or been credited that is still
  // unspent — offered against this document rather than left stranded.
  const heldCredit: HeldCredit[] = [
    ...(openPayments ?? []).map((p) => ({
      id: p.payment_id as string,
      kind: "payment" as const,
      label: `Payment of ${p.paid_on}`,
      available_minor: p.unapplied_minor ?? 0,
    })),
    ...(openCredits ?? [])
      // A note cannot be applied to the document it was raised against twice
      // over, but it can be applied to a different one — so only this
      // document's own note is excluded.
      .filter((c) => c.document_id !== doc.id)
      .map((c) => ({
        id: c.document_id as string,
        kind: "credit_note" as const,
        label: `Credit note ${c.doc_no ?? ""}`.trim(),
        available_minor: c.unapplied_minor ?? 0,
      })),
  ];

  return (
    <div className="max-w-[900px] space-y-6 p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/documents" className="text-[13px] text-ink-2 hover:text-ink">
            ← Documents
          </Link>
          <h1 className="mt-2 font-mono text-[22px] font-semibold tracking-[-0.01em] text-ink">
            {doc.doc_no ?? doc.party_doc_no ?? "—"}
          </h1>
          <p className="mt-1 text-[13.5px] text-ink-2">
            {snapshot?.counterparty.name ?? "—"} · {doc.doc_date}
            {doc.due_date && <> · due {doc.due_date}</>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${TONE[overdue ? "overdue" : state.tone]}`}>
            {overdue ? "Overdue" : state.label}
          </span>
          {snapshot && (
            <a href={`/api/documents/${doc.id}/pdf`} target="_blank" rel="noreferrer" className={buttonSecondaryClass}>
              Open PDF
            </a>
          )}
        </div>
      </header>

      {!snapshot ? (
        <p className="rounded-[10px] border border-line bg-white p-8 text-center text-[13.5px] text-ink-3">
          This document has not been issued yet.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
            <table className="w-full text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-line-soft text-[12px] uppercase tracking-wide text-ink-3">
                  <th className="px-5 py-3 font-medium">Description</th>
                  <th className="px-5 py-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.lines.map((line, i) => (
                  <tr key={i} className="border-b border-line-soft last:border-b-0">
                    <td className="px-5 py-3">
                      <span className="block text-ink">{line.description}</span>
                      {/* The descriptive body, frozen at issue — the labels are
                          the ones that were in force that day, not today's. */}
                      {line.printable_details.length > 0 && (
                        <span className="mt-0.5 block text-[12.5px] text-ink-3">
                          {line.printable_details.map((d) => `${d.label}: ${d.value}`).join(" · ")}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-ink">{money(line.amount_minor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="border-t border-line px-5 py-4">
              <dl className="ml-auto max-w-[280px] space-y-1.5 text-[13.5px]">
                <div className="flex justify-between">
                  <dt className="text-ink-2">Taxable value</dt>
                  <dd className="font-mono text-ink">{money(snapshot.document.taxable_value_minor)}</dd>
                </div>
                {/* However many components the regime produced — two, one, or
                    none at all. Nothing here knows which country this is. */}
                {snapshot.taxes.map((t, i) => (
                  <div key={i} className="flex justify-between">
                    <dt className="text-ink-2">{t.component_label}</dt>
                    <dd className="font-mono text-ink">{money(t.amount_minor)}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-line pt-1.5">
                  <dt className="font-medium text-ink">Total</dt>
                  <dd className="font-mono font-semibold text-ink">{money(snapshot.document.total_minor)}</dd>
                </div>
                {balance && balance.balance_due_minor !== snapshot.document.total_minor && (
                  <div className="flex justify-between">
                    <dt className="text-ink-2">Outstanding</dt>
                    <dd className={`font-mono ${overdue ? "text-overdue" : "text-ink"}`}>
                      {money(balance.balance_due_minor)}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </div>

          {snapshot.document.tax_treatment !== "forward" && (
            <p className="rounded-[10px] border border-line bg-paper p-4 text-[13px] text-ink-2">
              {snapshot.document.tax_treatment === "exempt"
                ? "Exempt / nil-rated — no tax charged."
                : "Tax payable by the recipient under reverse charge."}
            </p>
          )}

          <section className="space-y-3">
            <h2 className="text-[15px] font-medium text-ink">Payments</h2>
            {(allocations ?? []).length === 0 ? (
              <p className="text-[13.5px] text-ink-3">
                {doc.direction === "payable" ? "Nothing paid against this yet." : "Nothing received against this yet."}
              </p>
            ) : (
              <ul className="divide-y divide-line-soft rounded-[10px] border border-line bg-white">
                {(allocations ?? []).map((a) => {
                  const p = (a as unknown as {
                    payments: { paid_on: string; method: string; reference_no: string | null } | null;
                  }).payments;
                  return (
                    <li key={a.id} className="flex items-baseline justify-between p-3.5 text-[13.5px]">
                      <span className="text-ink-2">
                        {p ? `${p.paid_on} · ${p.method}` : "Credit note applied"}
                        {p?.reference_no && <span className="ml-2 font-mono text-ink-3">{p.reference_no}</span>}
                      </span>
                      <span className="font-mono text-ink">{money(a.amount_minor)}</span>
                    </li>
                  );
                })}
              </ul>
            )}

            {auth.ctx.role === "owner" &&
              doc.status === "issued" &&
              balance !== null &&
              balance.balance_due_minor > 0 && (
                <RecordPaymentForm
                  documentId={doc.id}
                  partyId={doc.counterparty_id}
                  balanceMinor={balance.balance_due_minor}
                  currency={doc.currency}
                  locale={locale}
                  today={today}
                  direction={doc.direction as "receivable" | "payable"}
                />
              )}
          </section>

          {/* Only for invoices and bills. A credit note is a source of an
              offset, never a target of one, so it has nothing to cancel
              against and nothing to apply to it. */}
          {(doc.doc_kind === "invoice" || doc.doc_kind === "bill") && (
            <DocumentActions
              documentId={doc.id}
              currency={doc.currency}
              locale={locale}
              balanceMinor={balance?.balance_due_minor ?? 0}
              appliedMinor={(balance?.settled_minor ?? 0) + (balance?.credited_minor ?? 0)}
              totalMinor={snapshot.document.total_minor}
              status={doc.status}
              isOwner={auth.ctx.role === "owner"}
              heldCredit={heldCredit}
            />
          )}
        </>
      )}
    </div>
  );
}
