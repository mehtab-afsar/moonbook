import Link from "next/link";
import { redirect } from "next/navigation";
import { Wallet, AlertTriangle, TrendingUp, Banknote } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { formatMoney } from "@/lib/money";
import { resolvePeriod } from "@/lib/dashboard/period";
import { PeriodPicker } from "@/features/dashboard/components/PeriodPicker";
import { StatCard } from "@/features/dashboard/components/StatCard";
import {
  RecentActivityTabs,
  type RecentServiceRow,
  type RecentInvoiceRow,
  type RecentReceiptRow,
} from "@/features/logistics/components/RecentActivityTabs";
import { buttonPrimaryClass, buttonSecondaryClass } from "@/lib/ui/styles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function LogisticsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");
  if (auth.ctx.vertical !== "logistics") redirect("/dashboard");

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organisations").select("locale, timezone, base_currency").eq("id", auth.ctx.orgId).single();

  const locale = org?.locale ?? "en";
  const timezone = org?.timezone ?? "UTC";
  const period = resolvePeriod(await searchParams, timezone);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());

  const [
    { data: openDocs },
    { data: periodServices },
    { data: periodReceipts },
    { data: recentServices },
    { data: recentInvoices },
    { data: recentReceipts },
  ] = await Promise.all([
    supabase
      .from("logistics_document_balances")
      .select("currency, balance_due_minor, due_date, counterparty_id")
      .eq("direction", "receivable")
      .gt("balance_due_minor", 0),
    supabase
      .from("logistics_activities")
      .select("currency, amount_minor, direct_cost_minor")
      .eq("direction", "receivable")
      .in("status", ["completed", "invoiced"])
      .gte("occurred_on", period.from)
      .lte("occurred_on", period.to),
    supabase
      .from("logistics_payments")
      .select("currency, amount_minor")
      .eq("direction", "in")
      .gte("paid_on", period.from)
      .lte("paid_on", period.to),
    // A quick-glance feed, not the full log — each tab's own page has the rest.
    supabase
      .from("logistics_activities")
      .select("id, direction, occurred_on, origin, destination, vendor_ref, amount_minor, currency, status, parties!logistics_activities_party_org_fk(name)")
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("logistics_documents")
      .select("id, doc_kind, doc_no, doc_date, status, currency, total_minor, parties!logistics_documents_counterparty_org_fk(name)")
      .order("doc_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("logistics_payments")
      .select("id, paid_on, method, amount_minor, currency, parties!logistics_payments_party_org_fk(name)")
      .eq("direction", "in")
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  type Totals = {
    outstanding: number; overdue: number; docs: number; parties: Set<string>;
    revenue: number; cost: number; collected: number;
  };
  const byCurrency = new Map<string, Totals>();
  const get = (currency: string): Totals =>
    byCurrency.get(currency) ??
    (() => {
      const t: Totals = { outstanding: 0, overdue: 0, docs: 0, parties: new Set(), revenue: 0, cost: 0, collected: 0 };
      byCurrency.set(currency, t);
      return t;
    })();

  for (const d of openDocs ?? []) {
    if (!d.currency) continue;
    const t = get(d.currency);
    const balance = d.balance_due_minor ?? 0;
    t.outstanding += balance;
    if (d.due_date && d.due_date < today) t.overdue += balance;
    t.docs += 1;
    if (d.counterparty_id) t.parties.add(d.counterparty_id as string);
  }
  for (const a of periodServices ?? []) {
    const t = get(a.currency);
    t.revenue += a.amount_minor;
    t.cost += a.direct_cost_minor ?? 0;
  }
  for (const p of periodReceipts ?? []) {
    const t = get(p.currency);
    t.collected += p.amount_minor;
  }

  const currencies = [...byCurrency.keys()];
  if (currencies.length === 0) currencies.push(org?.base_currency ?? "INR");

  const serviceRows: RecentServiceRow[] = ((recentServices ?? []) as unknown as {
    id: string; direction: "receivable" | "payable"; occurred_on: string;
    origin: string | null; destination: string | null; vendor_ref: string | null;
    amount_minor: number; currency: string; status: string;
    parties: { name: string } | null;
  }[]).map((a) => ({ ...a, party_name: a.parties?.name ?? null }));

  const invoiceRows: RecentInvoiceRow[] = ((recentInvoices ?? []) as unknown as {
    id: string; doc_kind: string; doc_no: string | null; doc_date: string;
    status: string; currency: string; total_minor: number;
    parties: { name: string } | null;
  }[]).map((d) => ({ ...d, party_name: d.parties?.name ?? null }));

  const receiptRows: RecentReceiptRow[] = ((recentReceipts ?? []) as unknown as {
    id: string; paid_on: string; method: string; amount_minor: number; currency: string;
    parties: { name: string } | null;
  }[]).map((p) => ({ ...p, party_name: p.parties?.name ?? null }));

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Dashboard</h1>
          <p className="mt-1 text-[13.5px] text-ink-2">Where things stand, and what&apos;s moved lately.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/logistics/activities" className={buttonSecondaryClass}>Log a service</Link>
          <Link href="/logistics/documents/new" className={buttonPrimaryClass}>Issue an invoice</Link>
        </div>
      </header>

      {currencies.map((currency) => {
        const t = byCurrency.get(currency) ?? {
          outstanding: 0, overdue: 0, docs: 0, parties: new Set<string>(), revenue: 0, cost: 0, collected: 0,
        };
        const profit = t.revenue - t.cost;
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
                    sub={`${t.docs} across ${t.parties.size} ${t.parties.size === 1 ? "party" : "parties"} →`}
                    href="/logistics/documents?filter=outstanding"
                  />
                  <StatCard
                    icon={AlertTriangle}
                    label="Overdue"
                    value={formatMoney(t.overdue, currency, locale)}
                    tone="overdue"
                    bordered={false}
                    sub="See who's late →"
                    href="/logistics/documents?filter=overdue"
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
                    label="Profit"
                    value={formatMoney(profit, currency, locale)}
                    tone={profit < 0 ? "overdue" : "settled"}
                    bordered={false}
                    sub={`Revenue ${formatMoney(t.revenue, currency, locale)} − cost ${formatMoney(t.cost, currency, locale)}`}
                  />
                  <StatCard
                    icon={Banknote}
                    label="Collected"
                    value={formatMoney(t.collected, currency, locale)}
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

      <RecentActivityTabs services={serviceRows} invoices={invoiceRows} receipts={receiptRows} locale={locale} />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[12px] font-medium uppercase tracking-wide text-ink-3">{children}</h2>;
}
