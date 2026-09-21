import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { formatMoney } from "@/lib/money";
import { ReceiptForm, type OpenDocument } from "@/features/plastics/components/ReceiptForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payments" };

const METHOD_LABEL: Record<string, string> = { bank: "Bank transfer", cash: "Cash", cheque: "Cheque", card: "Card", online: "Online" };

function groupOpen(rows: { document_id: unknown; counterparty_id: unknown; doc_no: unknown; doc_date: unknown; due_date: unknown; currency: unknown; balance_due_minor: number | null }[]) {
  const byParty: Record<string, OpenDocument[]> = {};
  for (const d of rows) {
    const key = d.counterparty_id as string;
    (byParty[key] ??= []).push({
      id: d.document_id as string, doc_no: (d.doc_no as string) ?? "—", doc_date: d.doc_date as string,
      due_date: d.due_date as string | null, currency: d.currency as string, balance_due_minor: d.balance_due_minor ?? 0,
    });
  }
  return byParty;
}

export default async function PlasticsPaymentsPage() {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");
  if (auth.ctx.vertical !== "plastics") redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: org }, { data: parties }, { data: receipts }, { data: outPayments }, { data: openReceivable }, { data: openPayable }] = await Promise.all([
    supabase.from("organisations").select("locale, timezone, base_currency").eq("id", auth.ctx.orgId).single(),
    supabase.from("parties").select("id, name").order("name"),
    supabase.from("plastics_payments").select("id, paid_on, method, reference_no, currency, amount_minor, parties!plastics_payments_party_org_fk(name)").eq("direction", "in").order("paid_on", { ascending: false }).limit(200),
    supabase.from("plastics_payments").select("id, paid_on, method, reference_no, currency, amount_minor, parties!plastics_payments_party_org_fk(name)").eq("direction", "out").order("paid_on", { ascending: false }).limit(200),
    supabase.from("plastics_document_balances").select("document_id, counterparty_id, doc_no, doc_date, due_date, currency, balance_due_minor").eq("direction", "receivable").gt("balance_due_minor", 0),
    supabase.from("plastics_document_balances").select("document_id, counterparty_id, doc_no, doc_date, due_date, currency, balance_due_minor").eq("direction", "payable").gt("balance_due_minor", 0),
  ]);

  const locale = org?.locale ?? "en";
  const openByParty = groupOpen(openReceivable ?? []);
  const openPayableByParty = groupOpen(openPayable ?? []);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: org?.timezone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  return (
    <div className="space-y-10 p-8">
      <section className="space-y-6">
        <header>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Payments</h1>
          <p className="mt-1 text-[13.5px] text-ink-2">Money received from sales.</p>
        </header>
        <ReceiptForm parties={parties ?? []} openByParty={openByParty} locale={locale} today={today} direction="in" defaultCurrency={org?.base_currency ?? "INR"} />
        <PaymentsTable rows={receipts ?? []} locale={locale} partyColumn="From" emptyLabel="Nothing received yet." />
      </section>

      <section className="space-y-6">
        <header>
          <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">Payments to collectors</h2>
          <p className="mt-1 text-[13.5px] text-ink-2">Money paid for purchases, including advances paid before a bill arrives.</p>
        </header>
        <ReceiptForm parties={parties ?? []} openByParty={openPayableByParty} locale={locale} today={today} direction="out" defaultCurrency={org?.base_currency ?? "INR"} />
        <PaymentsTable rows={outPayments ?? []} locale={locale} partyColumn="To" emptyLabel="Nothing paid out yet." />
      </section>
    </div>
  );
}

type PaymentRow = { id: string; paid_on: string; method: string; reference_no: string | null; currency: string; amount_minor: number; parties: { name: string } | null };

function PaymentsTable({ rows, locale, partyColumn, emptyLabel }: { rows: unknown[]; locale: string; partyColumn: string; emptyLabel: string }) {
  const payments = rows as unknown as PaymentRow[];
  return (
    <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
      <table className="w-full text-left text-[13.5px]">
        <thead>
          <tr className="border-b border-line-soft text-[12px] uppercase tracking-wide text-ink-3">
            <th className="px-5 py-3 font-medium">Date</th><th className="px-5 py-3 font-medium">{partyColumn}</th>
            <th className="px-5 py-3 font-medium">How</th><th className="px-5 py-3 font-medium">Reference</th>
            <th className="px-5 py-3 font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {payments.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center text-ink-3">{emptyLabel}</td></tr>}
          {payments.map((p) => (
            <tr key={p.id} className="border-b border-line-soft last:border-b-0">
              <td className="px-5 py-3 font-mono text-ink-2">{p.paid_on}</td>
              <td className="px-5 py-3 font-medium text-ink">{p.parties?.name ?? "—"}</td>
              <td className="px-5 py-3 text-ink-2">{METHOD_LABEL[p.method] ?? p.method}</td>
              <td className="px-5 py-3 font-mono text-ink-2">{p.reference_no ?? "—"}</td>
              <td className="px-5 py-3 font-mono text-ink">{formatMoney(p.amount_minor, p.currency, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
