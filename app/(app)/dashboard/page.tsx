import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

type OutstandingRow = {
  party_id: string;
  direction: "receivable" | "payable";
  currency: string;
  documents_outstanding: number;
  amount_outstanding_minor: number;
  documents_overdue: number;
  amount_overdue_minor: number;
};

export default async function DashboardPage() {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");

  const supabase = await createClient();
  const [{ data: org }, { data: rows }, { data: parties }] = await Promise.all([
    supabase.from("organisations").select("legal_name, locale, base_currency").eq("id", auth.ctx.orgId).single(),
    supabase
      .from("party_outstanding")
      .select("party_id, direction, currency, documents_outstanding, amount_outstanding_minor, documents_overdue, amount_overdue_minor")
      .order("amount_outstanding_minor", { ascending: false }),
    supabase.from("parties").select("id, name"),
  ]);

  const locale = org?.locale ?? "en";
  const nameById = new Map((parties ?? []).map((p) => [p.id, p.name]));
  const outstanding = ((rows ?? []) as unknown as OutstandingRow[]).filter(
    (r) => r.direction === "receivable" && r.documents_outstanding > 0,
  );

  // Totals are kept per currency, never blended — see CONVENTIONS.md section 9.
  const byCurrency = new Map<string, { outstanding: number; overdue: number; docs: number }>();
  for (const r of outstanding) {
    const acc = byCurrency.get(r.currency) ?? { outstanding: 0, overdue: 0, docs: 0 };
    acc.outstanding += r.amount_outstanding_minor;
    acc.overdue += r.amount_overdue_minor;
    acc.docs += r.documents_outstanding;
    byCurrency.set(r.currency, acc);
  }

  return (
    <div className="space-y-8 p-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Dashboard</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">
          Every figure here is computed from documents, payments and credit notes on each
          read — never a stored counter.
        </p>
      </header>

      {byCurrency.size === 0 ? (
        <p className="rounded-[10px] border border-line bg-white p-8 text-center text-[13.5px] text-ink-3">
          Nothing outstanding yet. Once you issue a document, this updates on its own.
        </p>
      ) : (
        [...byCurrency.entries()].map(([currency, totals]) => (
          <section key={currency} className="space-y-3">
            <div className="grid gap-4 min-[720px]:grid-cols-3">
              <StatCard label={`Outstanding (${currency})`} value={formatMoney(totals.outstanding, currency, locale)} />
              <StatCard label="Overdue" value={formatMoney(totals.overdue, currency, locale)} tone="overdue" />
              <StatCard label="Open documents" value={String(totals.docs)} />
            </div>
          </section>
        ))
      )}

      <section>
        <h2 className="text-[15px] font-medium text-ink">Outstanding by party</h2>
        <div className="mt-3 overflow-x-auto rounded-[10px] border border-line bg-white">
          <table className="w-full text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-line-soft text-[12px] uppercase tracking-wide text-ink-3">
                <th className="px-5 py-3 font-medium">Party</th>
                <th className="px-5 py-3 font-medium">Documents</th>
                <th className="px-5 py-3 font-medium">Outstanding</th>
                <th className="px-5 py-3 font-medium">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {outstanding.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-ink-3">
                    No outstanding balances.
                  </td>
                </tr>
              )}
              {outstanding.map((r) => (
                <tr key={`${r.party_id}-${r.currency}`} className="border-b border-line-soft last:border-b-0">
                  <td className="px-5 py-3 font-medium text-ink">{nameById.get(r.party_id) ?? "—"}</td>
                  <td className="px-5 py-3 font-mono text-ink-2">{r.documents_outstanding}</td>
                  <td className="px-5 py-3 font-mono text-ink">
                    {formatMoney(r.amount_outstanding_minor, r.currency, locale)}
                  </td>
                  <td className="px-5 py-3 font-mono">
                    {r.amount_overdue_minor > 0 ? (
                      <span className="text-overdue">{formatMoney(r.amount_overdue_minor, r.currency, locale)}</span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "overdue" }) {
  return (
    <div className="rounded-[10px] border border-line bg-white p-5">
      <p className="text-[12.5px] text-ink-2">{label}</p>
      <p
        className={`mt-1.5 font-mono text-[24px] font-semibold ${
          tone === "overdue" ? "text-overdue" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
