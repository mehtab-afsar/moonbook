import Link from "next/link";
import { redirect } from "next/navigation";
import { Wallet, AlertTriangle, TrendingUp, Banknote, TrendingDown, FileStack } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { formatMoney } from "@/lib/money";
import { resolvePeriod } from "@/lib/dashboard/period";
import { PeriodPicker } from "@/features/dashboard/components/PeriodPicker";
import { StatCard } from "@/features/dashboard/components/StatCard";
import { buttonPrimaryClass, buttonSecondaryClass } from "@/lib/ui/styles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function PlasticsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");
  if (auth.ctx.vertical !== "plastics") redirect("/dashboard");

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organisations").select("locale, timezone, base_currency").eq("id", auth.ctx.orgId).single();

  const locale = org?.locale ?? "en";
  const timezone = org?.timezone ?? "UTC";
  const period = resolvePeriod(await searchParams, timezone);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());

  const [{ data: openDocs }, { data: periodActivities }, { data: periodPayments }] = await Promise.all([
    supabase
      .from("plastics_document_balances")
      .select("currency, direction, balance_due_minor, due_date")
      .gt("balance_due_minor", 0),
    supabase
      .from("plastics_activities")
      .select("currency, direction, amount_minor")
      .in("status", ["completed", "invoiced"])
      .gte("occurred_on", period.from)
      .lte("occurred_on", period.to),
    supabase
      .from("plastics_payments")
      .select("currency, direction, amount_minor")
      .gte("paid_on", period.from)
      .lte("paid_on", period.to),
  ]);

  // Kept separate, never netted — what's owed to collectors and what's owed
  // by processors are two different ledgers, the same rule the shared
  // engine's scrap template follows.
  type Side = { outstanding: number; overdue: number; docs: number; period: number; cash: number };
  const receivable = new Map<string, Side>();
  const payable = new Map<string, Side>();
  const get = (map: Map<string, Side>, currency: string): Side =>
    map.get(currency) ?? (() => {
      const s: Side = { outstanding: 0, overdue: 0, docs: 0, period: 0, cash: 0 };
      map.set(currency, s);
      return s;
    })();

  for (const d of openDocs ?? []) {
    if (!d.currency) continue;
    const balance = d.balance_due_minor ?? 0;
    const side = d.direction === "receivable" ? receivable : payable;
    const acc = get(side, d.currency);
    acc.outstanding += balance;
    if (d.direction === "receivable" && d.due_date && d.due_date < today) acc.overdue += balance;
    acc.docs += 1;
  }
  for (const a of periodActivities ?? []) {
    const side = a.direction === "receivable" ? receivable : payable;
    get(side, a.currency).period += a.amount_minor;
  }
  for (const p of periodPayments ?? []) {
    const side = p.direction === "in" ? receivable : payable;
    get(side, p.currency).cash += p.amount_minor;
  }

  const currencies = [...new Set([...receivable.keys(), ...payable.keys()])];
  if (currencies.length === 0) currencies.push(org?.base_currency ?? "USD");

  return (
    <div className="mx-auto max-w-[1200px] space-y-8 p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Dashboard</h1>
          <p className="mt-1 text-[13.5px] text-ink-2">The plastics ledger — its own tables, its own numbers.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/plastics/documents/new/bill" className={buttonSecondaryClass}>Record a bill</Link>
          <Link href="/plastics/documents/new" className={buttonPrimaryClass}>Issue an invoice</Link>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12px] font-medium uppercase tracking-wide text-ink-3">{period.label}</span>
        <PeriodPicker activePreset={period.preset} from={period.from} to={period.to} />
      </div>

      {currencies.map((currency) => {
        const r = receivable.get(currency) ?? { outstanding: 0, overdue: 0, docs: 0, period: 0, cash: 0 };
        const p = payable.get(currency) ?? { outstanding: 0, overdue: 0, docs: 0, period: 0, cash: 0 };
        return (
          <div key={currency} className="grid gap-4 min-[820px]:grid-cols-2">
            <section className="rounded-[10px] border border-line bg-white p-5">
              <h2 className="text-[15px] font-medium text-ink">Owed to us (sales){currencies.length > 1 ? ` — ${currency}` : ""}</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <StatCard icon={Wallet} label="Outstanding" value={formatMoney(r.outstanding, currency, locale)} bordered={false} sub={`${r.docs} open`} />
                <StatCard icon={AlertTriangle} label="Overdue" value={formatMoney(r.overdue, currency, locale)} tone="overdue" bordered={false} href="/plastics/documents" />
                <StatCard icon={TrendingUp} label="Sold, this period" value={formatMoney(r.period, currency, locale)} bordered={false} />
                <StatCard icon={Banknote} label="Collected" value={formatMoney(r.cash, currency, locale)} tone="settled" bordered={false} />
              </div>
            </section>

            <section className="rounded-[10px] border border-line bg-white p-5">
              <h2 className="text-[15px] font-medium text-ink">Owed by us (purchases){currencies.length > 1 ? ` — ${currency}` : ""}</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <StatCard icon={Wallet} label="Outstanding" value={formatMoney(p.outstanding, currency, locale)} bordered={false} sub={`${p.docs} open`} />
                <StatCard icon={TrendingDown} label="Bought, this period" value={formatMoney(p.period, currency, locale)} bordered={false} />
                <StatCard icon={Banknote} label="Paid out" value={formatMoney(p.cash, currency, locale)} bordered={false} sub="cash sent" />
              </div>
            </section>
          </div>
        );
      })}

      {receivable.size === 0 && payable.size === 0 && (
        <p className="flex flex-col items-center gap-2 rounded-[10px] border border-line bg-white p-10 text-center text-[13.5px] text-ink-3">
          <FileStack className="size-5" strokeWidth={1.5} />
          Nothing recorded yet. Once you log a purchase or sale, this updates on its own.
        </p>
      )}

      <p className="text-[12.5px] text-ink-3">
        Full breakdowns live under{" "}
        <Link href="/plastics/documents" className="font-medium text-brand hover:underline">Documents</Link>{" "}
        and{" "}
        <Link href="/plastics/activities" className="font-medium text-brand hover:underline">Purchases &amp; sales</Link>.
      </p>
    </div>
  );
}
