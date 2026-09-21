import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function LogisticsDashboardPage() {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");
  if (auth.ctx.vertical !== "logistics") redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: org }, { data: openDocs }, { data: marginRows }] = await Promise.all([
    supabase.from("organisations").select("locale").eq("id", auth.ctx.orgId).single(),
    supabase
      .from("logistics_document_balances")
      .select("currency, balance_due_minor, due_date, direction")
      .eq("direction", "receivable")
      .gt("balance_due_minor", 0),
    supabase
      .from("logistics_activities")
      .select("currency, amount_minor, direct_cost_minor")
      .eq("direction", "receivable")
      .in("status", ["completed", "invoiced"])
      .not("direct_cost_minor", "is", null),
  ]);

  const locale = org?.locale ?? "en";
  const today = new Date().toISOString().slice(0, 10);

  const byCurrency = new Map<string, { outstanding: number; overdue: number; docs: number }>();
  for (const d of openDocs ?? []) {
    if (!d.currency) continue;
    const balance = d.balance_due_minor ?? 0;
    const acc = byCurrency.get(d.currency) ?? { outstanding: 0, overdue: 0, docs: 0 };
    acc.outstanding += balance;
    if (d.due_date && d.due_date < today) acc.overdue += balance;
    acc.docs += 1;
    byCurrency.set(d.currency, acc);
  }

  const marginByCurrency = new Map<string, { revenue: number; cost: number; margin: number }>();
  for (const a of marginRows ?? []) {
    const acc = marginByCurrency.get(a.currency) ?? { revenue: 0, cost: 0, margin: 0 };
    acc.revenue += a.amount_minor;
    acc.cost += a.direct_cost_minor ?? 0;
    acc.margin += a.amount_minor - (a.direct_cost_minor ?? 0);
    marginByCurrency.set(a.currency, acc);
  }

  return (
    <div className="space-y-8 p-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Dashboard</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">The logistics ledger — its own tables, its own numbers.</p>
      </header>

      {byCurrency.size === 0 ? (
        <p className="rounded-[10px] border border-line bg-white p-8 text-center text-[13.5px] text-ink-3">Nothing outstanding yet.</p>
      ) : (
        [...byCurrency.entries()].map(([currency, totals]) => (
          <div key={currency} className="grid gap-4 min-[720px]:grid-cols-3">
            <StatCard label={`Outstanding (${currency})`} value={formatMoney(totals.outstanding, currency, locale)} />
            <StatCard label="Overdue" value={formatMoney(totals.overdue, currency, locale)} tone="overdue" />
            <StatCard label="Open documents" value={String(totals.docs)} />
          </div>
        ))
      )}

      {marginByCurrency.size > 0 && (
        <section className="space-y-3">
          <h2 className="text-[15px] font-medium text-ink">Margin</h2>
          {[...marginByCurrency.entries()].map(([currency, totals]) => (
            <div key={currency} className="grid gap-4 min-[720px]:grid-cols-3">
              <StatCard label={`Revenue (${currency})`} value={formatMoney(totals.revenue, currency, locale)} />
              <StatCard label="Direct cost" value={formatMoney(totals.cost, currency, locale)} />
              <StatCard label="Margin" value={formatMoney(totals.margin, currency, locale)} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "overdue" }) {
  return (
    <div className="rounded-[10px] border border-line bg-white p-5">
      <p className="text-[12.5px] text-ink-2">{label}</p>
      <p className={`mt-1.5 font-mono text-[24px] font-semibold ${tone === "overdue" ? "text-overdue" : "text-ink"}`}>{value}</p>
    </div>
  );
}
