import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function PlasticsDashboardPage() {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");
  if (auth.ctx.vertical !== "plastics") redirect("/dashboard");

  const supabase = await createClient();
  const { data: org } = await supabase.from("organisations").select("locale").eq("id", auth.ctx.orgId).single();
  const { data: openDocs } = await supabase
    .from("plastics_document_balances")
    .select("currency, direction, balance_due_minor, due_date")
    .gt("balance_due_minor", 0);

  const locale = org?.locale ?? "en";
  const today = new Date().toISOString().slice(0, 10);

  // Kept separate, never netted — what's owed to collectors and what's owed
  // by processors are two different ledgers, the same rule the shared
  // engine's scrap template follows.
  const receivable = new Map<string, { outstanding: number; overdue: number; docs: number }>();
  const payable = new Map<string, { outstanding: number; docs: number }>();
  for (const d of openDocs ?? []) {
    if (!d.currency) continue;
    const balance = d.balance_due_minor ?? 0;
    if (d.direction === "receivable") {
      const acc = receivable.get(d.currency) ?? { outstanding: 0, overdue: 0, docs: 0 };
      acc.outstanding += balance;
      if (d.due_date && d.due_date < today) acc.overdue += balance;
      acc.docs += 1;
      receivable.set(d.currency, acc);
    } else {
      const acc = payable.get(d.currency) ?? { outstanding: 0, docs: 0 };
      acc.outstanding += balance;
      acc.docs += 1;
      payable.set(d.currency, acc);
    }
  }

  return (
    <div className="space-y-8 p-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Dashboard</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">The plastics ledger — its own tables, its own numbers.</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-[15px] font-medium text-ink">Owed to us (sales)</h2>
        {receivable.size === 0 ? (
          <p className="rounded-[10px] border border-line bg-white p-6 text-center text-[13.5px] text-ink-3">Nothing outstanding.</p>
        ) : (
          [...receivable.entries()].map(([currency, t]) => (
            <div key={currency} className="grid gap-4 min-[720px]:grid-cols-3">
              <StatCard label={`Outstanding (${currency})`} value={formatMoney(t.outstanding, currency, locale)} />
              <StatCard label="Overdue" value={formatMoney(t.overdue, currency, locale)} tone="overdue" />
              <StatCard label="Open documents" value={String(t.docs)} />
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-medium text-ink">Owed by us (purchases)</h2>
        {payable.size === 0 ? (
          <p className="rounded-[10px] border border-line bg-white p-6 text-center text-[13.5px] text-ink-3">Nothing outstanding.</p>
        ) : (
          [...payable.entries()].map(([currency, t]) => (
            <div key={currency} className="grid gap-4 min-[720px]:grid-cols-2">
              <StatCard label={`Outstanding (${currency})`} value={formatMoney(t.outstanding, currency, locale)} />
              <StatCard label="Open bills" value={String(t.docs)} />
            </div>
          ))
        )}
      </section>
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
