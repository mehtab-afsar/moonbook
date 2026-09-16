import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { formatMoney } from "@/lib/money";
import { ReceiptForm, type OpenDocument } from "@/features/payments/components/ReceiptForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payments" };

const METHOD_LABEL: Record<string, string> = {
  bank: "Bank transfer",
  cash: "Cash",
  cheque: "Cheque",
  card: "Card",
  online: "Online",
};

export default async function PaymentsPage() {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");

  const supabase = await createClient();
  const [{ data: org }, { data: parties }, { data: payments, error }, { data: open }, { data: applied }] =
    await Promise.all([
      supabase.from("organisations").select("locale, timezone").eq("id", auth.ctx.orgId).single(),
      supabase.from("parties").select("id, name").order("name"),
      supabase
        .from("payments")
        // FK named: payments reaches parties by one key today, but naming it
        // costs nothing and survives the second one being added.
        .select(
          "id, paid_on, method, reference_no, currency, amount_minor, party_id, parties!payments_party_id_fkey(name)",
        )
        .eq("direction", "in")
        .order("paid_on", { ascending: false })
        .limit(200),
      // Views, fetched separately — PostgREST cannot embed one.
      supabase
        .from("document_balances")
        .select("document_id, counterparty_id, doc_no, doc_date, due_date, currency, balance_due_minor")
        .gt("balance_due_minor", 0)
        .order("doc_date"),
      supabase.from("payment_balances").select("payment_id, applied_minor, unapplied_minor"),
    ]);

  if (error) throw new Error(`Could not load payments: ${error.message}`);

  const locale = org?.locale ?? "en";

  const openByParty: Record<string, OpenDocument[]> = {};
  for (const d of open ?? []) {
    const key = d.counterparty_id as string;
    (openByParty[key] ??= []).push({
      id: d.document_id as string,
      doc_no: (d.doc_no as string) ?? "—",
      doc_date: d.doc_date as string,
      due_date: d.due_date as string | null,
      currency: d.currency as string,
      balance_due_minor: d.balance_due_minor ?? 0,
    });
  }

  const unappliedById = new Map(
    (applied ?? []).map((a) => [a.payment_id as string, a.unapplied_minor ?? 0]),
  );

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: org?.timezone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Payments</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">
          Money received. A receipt need not settle anything exactly — whatever is left over
          stays visible as unapplied credit rather than being forced onto an invoice.
        </p>
      </header>

      <ReceiptForm
        parties={parties ?? []}
        openByParty={openByParty}
        locale={locale}
        today={today}
      />

      <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-line-soft text-[12px] uppercase tracking-wide text-ink-3">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">From</th>
              <th className="px-5 py-3 font-medium">How</th>
              <th className="px-5 py-3 font-medium">Reference</th>
              <th className="px-5 py-3 font-medium">Amount</th>
              <th className="px-5 py-3 font-medium">Unapplied</th>
            </tr>
          </thead>
          <tbody>
            {(payments ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-ink-3">
                  Nothing received yet.
                </td>
              </tr>
            )}
            {(payments ?? []).map((p) => {
              const party = (p as unknown as { parties: { name: string } | null }).parties;
              const unapplied = unappliedById.get(p.id) ?? 0;
              return (
                <tr key={p.id} className="border-b border-line-soft last:border-b-0">
                  <td className="px-5 py-3 font-mono text-ink-2">{p.paid_on}</td>
                  <td className="px-5 py-3 font-medium text-ink">{party?.name ?? "—"}</td>
                  <td className="px-5 py-3 text-ink-2">{METHOD_LABEL[p.method] ?? p.method}</td>
                  <td className="px-5 py-3 font-mono text-ink-2">{p.reference_no ?? "—"}</td>
                  <td className="px-5 py-3 font-mono text-ink">
                    {formatMoney(p.amount_minor, p.currency, locale)}
                  </td>
                  <td className="px-5 py-3 font-mono">
                    {unapplied > 0 ? (
                      <span className="text-pending-ink">
                        {formatMoney(unapplied, p.currency, locale)}
                      </span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
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
