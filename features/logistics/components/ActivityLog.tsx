"use client";

import { formatMoney } from "@/lib/money";
import { ActivityForm } from "@/features/logistics/components/ActivityForm";

const STATUS_STYLE: Record<string, string> = {
  completed: "bg-settled-tint text-settled-ink",
  invoiced: "bg-line-soft text-ink-2",
  cancelled: "bg-overdue-tint text-overdue",
};

export interface LogisticsLogRow {
  id: string;
  direction: "receivable" | "payable";
  occurred_on: string;
  origin: string | null;
  destination: string | null;
  vendor_ref: string | null;
  reference: string | null;
  amount_minor: number;
  direct_cost_minor: number | null;
  currency: string;
  status: string;
  party_name: string;
}

export function ActivityLog({
  parties,
  rows,
  currency,
  locale,
}: {
  parties: { id: string; name: string }[];
  rows: LogisticsLogRow[];
  currency: string;
  locale: string;
}) {
  return (
    <div className="space-y-6">
      <ActivityForm parties={parties} currency={currency} locale={locale} />

      <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-line-soft text-[12px] uppercase tracking-wide text-ink-3">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">What</th>
              <th className="px-5 py-3 font-medium">Party</th>
              <th className="px-5 py-3 font-medium">Amount</th>
              <th className="px-5 py-3 font-medium">Margin</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-ink-3">Nothing recorded yet.</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line-soft last:border-b-0">
                <td className="px-5 py-3 font-mono text-ink-2">{r.occurred_on}</td>
                <td className="px-5 py-3 text-ink">
                  {r.direction === "receivable"
                    ? `${r.origin ?? "—"} → ${r.destination ?? "—"}`
                    : `Vendor charge${r.vendor_ref ? ` · ${r.vendor_ref}` : ""}`}
                </td>
                <td className="px-5 py-3 font-medium text-ink">{r.party_name}</td>
                <td className="px-5 py-3 font-mono text-ink">{formatMoney(r.amount_minor, r.currency, locale)}</td>
                <td className="px-5 py-3 font-mono text-ink-2">
                  {r.direction === "receivable" && r.direct_cost_minor !== null
                    ? formatMoney(r.amount_minor - r.direct_cost_minor, r.currency, locale)
                    : "—"}
                </td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${STATUS_STYLE[r.status] ?? ""}`}>
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
