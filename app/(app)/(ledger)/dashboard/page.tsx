import Link from "next/link";
import { redirect } from "next/navigation";
import { Wallet, AlertTriangle, FileStack, TrendingUp, Banknote, ArrowUpRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { formatMoney } from "@/lib/money";
import { resolvePeriod } from "@/lib/dashboard/period";
import { PeriodPicker } from "@/features/dashboard/components/PeriodPicker";
import { StatCard } from "@/features/dashboard/components/StatCard";
import { buttonPrimaryClass, buttonSecondaryClass } from "@/lib/ui/styles";

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

type MarginRow = {
  currency: string;
  revenue_minor: number;
  direct_cost_minor: number | null;
  margin_minor: number;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");

  const supabase = await createClient();
  const [{ data: org }, { data: rows }, { data: parties }, { data: marginRows }] = await Promise.all([
    supabase.from("organisations").select("legal_name, locale, timezone, base_currency").eq("id", auth.ctx.orgId).single(),
    supabase
      .from("party_outstanding")
      .select("party_id, direction, currency, documents_outstanding, amount_outstanding_minor, documents_overdue, amount_overdue_minor")
      .order("amount_outstanding_minor", { ascending: false }),
    supabase.from("parties").select("id, name"),
    // Only where a direct cost was actually entered — activity_margin
    // defaults a missing cost to 0, and treating that as "100% margin"
    // would report absent data as a real figure.
    supabase
      .from("activity_margin")
      .select("currency, revenue_minor, direct_cost_minor, margin_minor")
      .eq("direction", "receivable")
      .eq("uses_job_margin", true)
      .in("status", ["completed", "invoiced"])
      .not("direct_cost_minor", "is", null),
  ]);

  const locale = org?.locale ?? "en";
  const timezone = org?.timezone ?? "UTC";
  const period = resolvePeriod(await searchParams, timezone);

  const nameById = new Map((parties ?? []).map((p) => [p.id, p.name]));
  const outstanding = ((rows ?? []) as unknown as OutstandingRow[]).filter(
    (r) => r.direction === "receivable" && r.documents_outstanding > 0,
  );

  // Totals are kept per currency, never blended — see CONVENTIONS.md section 9.
  const byCurrency = new Map<string, { outstanding: number; overdue: number; docs: number; parties: Set<string> }>();
  for (const r of outstanding) {
    const acc = byCurrency.get(r.currency) ?? { outstanding: 0, overdue: 0, docs: 0, parties: new Set<string>() };
    acc.outstanding += r.amount_outstanding_minor;
    acc.overdue += r.amount_overdue_minor;
    acc.docs += r.documents_outstanding;
    acc.parties.add(r.party_id);
    byCurrency.set(r.currency, acc);
  }

  const marginByCurrency = new Map<string, { revenue: number; cost: number; margin: number }>();
  for (const r of (marginRows ?? []) as unknown as MarginRow[]) {
    const acc = marginByCurrency.get(r.currency) ?? { revenue: 0, cost: 0, margin: 0 };
    acc.revenue += r.revenue_minor;
    acc.cost += r.direct_cost_minor ?? 0;
    acc.margin += r.margin_minor;
    marginByCurrency.set(r.currency, acc);
  }

  // Period activity — revenue billed and cash collected in the chosen
  // window. Kept separate from the Margin section below: this counts every
  // receivable activity regardless of whether a direct cost was ever
  // entered, so it answers "how much did we bill/collect", not "how
  // profitable was it" — the one figure that DOES need the cost-recorded
  // filter to avoid silently reporting absent data as a real number.
  const [{ data: periodActivities }, { data: periodPayments }] = await Promise.all([
    supabase
      .from("activities")
      .select("currency, amount_minor")
      .eq("direction", "receivable")
      .in("status", ["completed", "invoiced"])
      .gte("occurred_on", period.from)
      .lte("occurred_on", period.to),
    supabase
      .from("payments")
      .select("currency, amount_minor")
      .eq("direction", "in")
      .gte("paid_on", period.from)
      .lte("paid_on", period.to),
  ]);

  const periodByCurrency = new Map<string, { revenue: number; collected: number }>();
  const getPeriod = (currency: string) => {
    const existing = periodByCurrency.get(currency);
    if (existing) return existing;
    const fresh = { revenue: 0, collected: 0 };
    periodByCurrency.set(currency, fresh);
    return fresh;
  };
  for (const a of periodActivities ?? []) getPeriod(a.currency).revenue += a.amount_minor;
  for (const p of periodPayments ?? []) getPeriod(p.currency).collected += p.amount_minor;

  const currencies = [...new Set([...byCurrency.keys(), ...periodByCurrency.keys()])];
  if (currencies.length === 0) currencies.push(org?.base_currency ?? "USD");

  return (
    <div className="mx-auto max-w-[1200px] space-y-8 p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Dashboard</h1>
          <p className="mt-1 text-[13.5px] text-ink-2">
            {org?.legal_name ? `${org.legal_name} — ` : ""}every figure here is computed on read, never a stored counter.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/documents/new/bill" className={buttonSecondaryClass}>Record a bill</Link>
          <Link href="/documents/new" className={buttonPrimaryClass}>Issue an invoice</Link>
        </div>
      </header>

      {currencies.map((currency) => {
        const t = byCurrency.get(currency) ?? { outstanding: 0, overdue: 0, docs: 0, parties: new Set<string>() };
        const p = periodByCurrency.get(currency) ?? { revenue: 0, collected: 0 };
        return (
          <section key={currency} className="rounded-[10px] border border-line bg-white p-5">
            <div className="grid gap-6 min-[720px]:grid-cols-2">
              <div>
                <SectionLabel>As of today{currencies.length > 1 ? ` (${currency})` : ""}</SectionLabel>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <StatCard
                    icon={Wallet}
                    label="Outstanding"
                    value={formatMoney(t.outstanding, currency, locale)}
                    bordered={false}
                    sub={`${t.docs} across ${t.parties.size} ${t.parties.size === 1 ? "party" : "parties"}`}
                  />
                  <StatCard
                    icon={AlertTriangle}
                    label="Overdue"
                    value={formatMoney(t.overdue, currency, locale)}
                    tone="overdue"
                    bordered={false}
                    sub="Chase it from Documents →"
                    href="/documents"
                  />
                </div>
              </div>

              <div className="border-t border-line-soft pt-6 min-[720px]:border-l min-[720px]:border-t-0 min-[720px]:pl-6 min-[720px]:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SectionLabel>{period.label}</SectionLabel>
                  <PeriodPicker activePreset={period.preset} from={period.from} to={period.to} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <StatCard
                    icon={TrendingUp}
                    label="Revenue billed"
                    value={formatMoney(p.revenue, currency, locale)}
                    bordered={false}
                    sub="from issued and invoiced work"
                  />
                  <StatCard
                    icon={Banknote}
                    label="Collected"
                    value={formatMoney(p.collected, currency, locale)}
                    tone="settled"
                    bordered={false}
                    sub="cash received"
                  />
                </div>
              </div>
            </div>
          </section>
        );
      })}

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-medium text-ink">Outstanding by party</h2>
          <Link
            href="/parties"
            className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline"
          >
            All parties <ArrowUpRight className="size-3.5" strokeWidth={2} />
          </Link>
        </div>
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
                  <td colSpan={4} className="px-5 py-10">
                    <div className="flex flex-col items-center gap-2 text-center text-ink-3">
                      <FileStack className="size-5" strokeWidth={1.5} />
                      No outstanding balances. Once you issue a document, this updates on its own.
                    </div>
                  </td>
                </tr>
              )}
              {outstanding.map((r) => (
                <tr key={`${r.party_id}-${r.currency}`} className="border-b border-line-soft transition-colors duration-150 last:border-b-0 hover:bg-paper">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[11.5px] font-medium text-brand">
                        {(nameById.get(r.party_id) ?? "—").slice(0, 1).toUpperCase()}
                      </span>
                      <span className="font-medium text-ink">{nameById.get(r.party_id) ?? "—"}</span>
                    </div>
                  </td>
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

      {marginByCurrency.size > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-[15px] font-medium text-ink">Margin</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-3">
              Revenue against direct cost, for activity types where a per-job figure means
              something and a cost was entered. Work with no cost recorded is left out
              rather than counted as pure margin.
            </p>
          </div>
          {[...marginByCurrency.entries()].map(([currency, totals]) => (
            <div key={currency} className="grid gap-4 min-[720px]:grid-cols-3">
              <StatCard label={`Revenue (${currency})`} value={formatMoney(totals.revenue, currency, locale)} />
              <StatCard label="Direct cost" value={formatMoney(totals.cost, currency, locale)} />
              <StatCard label="Margin" value={formatMoney(totals.margin, currency, locale)} tone="settled" />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[12px] font-medium uppercase tracking-wide text-ink-3">{children}</h2>;
}
