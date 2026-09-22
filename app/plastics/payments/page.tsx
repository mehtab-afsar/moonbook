import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { type OpenDocument } from "@/features/plastics/components/ReceiptForm";
import { ReceiptsPanel, type PaymentRow } from "@/features/plastics/components/ReceiptsPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Receipts" };

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
  const [{ data: org }, { data: parties }, { data: receipts }, { data: outPayments }, { data: openReceivable }, { data: openPayable }, { data: applied }] = await Promise.all([
    supabase.from("organisations").select("locale, timezone, base_currency").eq("id", auth.ctx.orgId).single(),
    supabase.from("parties").select("id, name, kind").order("name"),
    supabase.from("plastics_payments").select("id, paid_on, method, reference_no, currency, amount_minor, parties!plastics_payments_party_org_fk(name)").eq("direction", "in").order("paid_on", { ascending: false }).limit(200),
    supabase.from("plastics_payments").select("id, paid_on, method, reference_no, currency, amount_minor, parties!plastics_payments_party_org_fk(name)").eq("direction", "out").order("paid_on", { ascending: false }).limit(200),
    supabase.from("plastics_document_balances").select("document_id, counterparty_id, doc_no, doc_date, due_date, currency, balance_due_minor").eq("direction", "receivable").gt("balance_due_minor", 0),
    supabase.from("plastics_document_balances").select("document_id, counterparty_id, doc_no, doc_date, due_date, currency, balance_due_minor").eq("direction", "payable").gt("balance_due_minor", 0),
    supabase.from("plastics_payment_balances").select("payment_id, applied_minor, unapplied_minor"),
  ]);

  const locale = org?.locale ?? "en";
  const partiesTyped = (parties ?? []).map((p) => ({ ...p, kind: p.kind as "client" | "vendor" | null }));
  const openByParty = groupOpen(openReceivable ?? []);
  const openPayableByParty = groupOpen(openPayable ?? []);
  const unappliedById = new Map((applied ?? []).map((a) => [a.payment_id as string, a.unapplied_minor ?? 0]));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: org?.timezone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const toRows = (rows: { id: string; paid_on: string; method: string; reference_no: string | null; currency: string; amount_minor: number; parties: { name: string } | null }[] | null): PaymentRow[] =>
    (rows ?? []).map((p) => ({
      id: p.id, paid_on: p.paid_on, method: p.method, reference_no: p.reference_no,
      currency: p.currency, amount_minor: p.amount_minor, party_name: p.parties?.name ?? null,
    }));

  return (
    <div className="mx-auto max-w-[1200px] space-y-10 p-8">
      <ReceiptsPanel
        heading="h1"
        title="Receipts"
        description="Money received from sales."
        addLabel="Record receipt"
        parties={partiesTyped}
        openByParty={openByParty}
        rows={toRows(receipts)}
        unappliedById={unappliedById}
        locale={locale}
        today={today}
        direction="in"
        defaultCurrency={org?.base_currency ?? "INR"}
        partyColumn="From"
        emptyLabel="Nothing received yet."
        pdfHrefPrefix="/api/plastics/payments"
      />

      <ReceiptsPanel
        heading="h2"
        title="Vendor payments"
        description="Money paid for purchases, including advances paid before a bill arrives."
        addLabel="Record payment"
        parties={partiesTyped}
        openByParty={openPayableByParty}
        rows={toRows(outPayments)}
        unappliedById={unappliedById}
        locale={locale}
        today={today}
        direction="out"
        defaultCurrency={org?.base_currency ?? "INR"}
        partyColumn="To"
        emptyLabel="Nothing paid out yet."
        pdfHrefPrefix="/api/plastics/payments"
      />
    </div>
  );
}
