"use client";

import { formatMoney } from "@/lib/money";
import { ActivityForm } from "@/features/plastics/components/ActivityForm";

const STATUS_STYLE: Record<string, string> = {
  completed: "bg-settled-tint text-settled-ink",
  invoiced: "bg-line-soft text-ink-2",
  cancelled: "bg-overdue-tint text-overdue",
};

export interface PlasticsLogRow {
  id: string;
  direction: "receivable" | "payable";
  occurred_on: string;
  material: string;
  grade: string | null;
  net_weight_kg: number;
  reference: string | null;
  amount_minor: number;
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
  rows: PlasticsLogRow[];
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
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-ink-3">Nothing recorded yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line-soft last:border-b-0">
                <td className="px-5 py-3 font-mono text-ink-2">{r.occurred_on}</td>
                <td className="px-5 py-3 text-ink">
                  {r.direction === "payable" ? "Purchase" : "Sale"} — {r.material}
                  {r.grade && <span className="ml-1 text-ink-3">({r.grade})</span>}
                  <span className="ml-2 text-ink-3">{r.net_weight_kg}kg</span>
                </td>
                <td className="px-5 py-3 font-medium text-ink">{r.party_name}</td>
                <td className="px-5 py-3 font-mono text-ink">{formatMoney(r.amount_minor, r.currency, locale)}</td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${STATUS_STYLE[r.status] ?? ""}`}>{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
