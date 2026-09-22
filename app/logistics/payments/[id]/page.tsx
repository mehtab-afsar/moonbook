import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { formatMoney } from "@/lib/money";
import { appliedStateLabel } from "@/lib/documents/settlement";
import { PartyCard } from "@/features/documents/components/PartyCard";
import { PaymentSummaryCard } from "@/features/documents/components/PaymentSummaryCard";
import { buttonPrimaryClass, buttonSecondaryClass } from "@/lib/ui/styles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Receipt" };

const METHOD_LABEL: Record<string, string> = {
  bank: "Bank transfer", cash: "Cash", cheque: "Cheque", card: "Card", online: "Online",
};

const TONE: Record<string, string> = {
  settled: "bg-settled-tint text-settled-ink",
  pending: "bg-pending-tint text-pending-ink",
  overdue: "bg-overdue-tint text-overdue",
  muted: "bg-line-soft text-ink-2",
};

export default async function LogisticsReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");
  if (auth.ctx.vertical !== "logistics") redirect("/dashboard");

  const { id } = await params;
  const supabase = await createClient();

  const { data: payment, error } = await supabase
    .from("logistics_payments")
    .select("id, direction, paid_on, method, reference_no, currency, amount_minor, parties!logistics_payments_party_org_fk(name, tax_id, tax_id_kind, region_code, email, phone)")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load this payment: ${error.message}`);
  if (!payment) notFound();

  const { data: org } = await supabase.from("organisations").select("locale").eq("id", auth.ctx.orgId).single();
  const locale = org?.locale ?? "en";
  const money = (minor: number) => formatMoney(minor, payment.currency, locale);
  const party = (payment as unknown as {
    parties: {
      name: string; tax_id: string | null; tax_id_kind: string | null;
      region_code: string | null; email: string | null; phone: string | null;
    } | null;
  }).parties;

  const { data: allocations } = await supabase
    .from("logistics_allocations")
    .select("id, amount_minor, logistics_documents(id, doc_no, doc_date, total_minor)")
    .eq("payment_id", id)
    .order("created_at");

  const applications = (allocations ?? []).map((a) => ({
    id: a.id,
    amount_minor: a.amount_minor,
    doc: (a as unknown as { logistics_documents: { id: string; doc_no: string | null; doc_date: string; total_minor: number } | null }).logistics_documents,
  }));
  const applied = applications.reduce((s, a) => s + a.amount_minor, 0);
  const unapplied = payment.amount_minor - applied;
  const state = appliedStateLabel(applied, unapplied);

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/logistics/payments" className="text-[13px] text-ink-2 hover:text-ink">← Receipts</Link>
          <h1 className="mt-2 font-mono text-[22px] font-semibold tracking-[-0.01em] text-ink">
            {money(payment.amount_minor)}
          </h1>
          <p className="mt-1 text-[13.5px] text-ink-2">
            {payment.direction === "in" ? "Received from" : "Paid to"} {party?.name ?? "—"} · {payment.paid_on} ·{" "}
            {METHOD_LABEL[payment.method] ?? payment.method}
            {payment.reference_no && <> · Ref {payment.reference_no}</>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${TONE[state.tone]}`}>
            {state.label}
          </span>
          <a href={`/api/logistics/payments/${payment.id}/pdf`} target="_blank" rel="noreferrer" className={buttonSecondaryClass}>
            Print
          </a>
          <a href={`/api/logistics/payments/${payment.id}/pdf?download=1`} className={buttonPrimaryClass}>
            Download PDF
          </a>
        </div>
      </header>

      <div className="grid gap-4 min-[640px]:grid-cols-2">
        <PartyCard
          label={payment.direction === "in" ? "Received from" : "Paid to"}
          name={party?.name ?? "—"}
          taxId={party?.tax_id}
          taxIdKind={party?.tax_id_kind}
          regionCode={party?.region_code}
          email={party?.email}
          phone={party?.phone}
        />
        <PaymentSummaryCard
          totalMinor={payment.amount_minor}
          appliedMinor={applied}
          unappliedMinor={unapplied}
          direction={payment.direction as "in" | "out"}
          currency={payment.currency}
          locale={locale}
          noun="invoices"
        />
      </div>

      <section className="space-y-3">
        <h2 className="text-[15px] font-medium text-ink">Applied to</h2>
        {applications.length === 0 ? (
          <p className="rounded-[10px] border border-line bg-white p-4 text-[13.5px] text-ink-3">
            Not applied to anything — held as{" "}
            {payment.direction === "in" ? "credit against a future invoice." : "an advance against a future bill."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
            <table className="w-full text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-line-soft text-[12px] uppercase tracking-wide text-ink-3">
                  <th className="px-5 py-3 font-medium">Invoice</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Invoice total</th>
                  <th className="px-5 py-3 font-medium">Applied</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((a) => (
                  <tr key={a.id} className="border-b border-line-soft last:border-b-0">
                    <td className="px-5 py-3 font-mono text-ink">
                      {a.doc ? (
                        <Link href={`/logistics/documents/${a.doc.id}`} className="text-brand hover:underline">
                          {a.doc.doc_no ?? "—"}
                        </Link>
                      ) : "—"}
                    </td>
                    <td className="px-5 py-3 font-mono text-ink-2">{a.doc?.doc_date ?? "—"}</td>
                    <td className="px-5 py-3 font-mono text-ink-2">{a.doc ? money(a.doc.total_minor) : "—"}</td>
                    <td className="px-5 py-3 font-mono text-ink">{money(a.amount_minor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
