"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { searchInputClass } from "@/lib/ui/styles";
import { ActivityForm } from "@/features/plastics/components/ActivityForm";
import { AttachmentButton } from "@/features/activities/components/AttachmentButton";
import type { PartyRole } from "@/lib/parties/roles";

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
  attachment_path: string | null;
}

export function ActivityLog({
  parties,
  rows,
  currency,
  locale,
  showForm,
  onShowFormChange,
}: {
  parties: { id: string; name: string; role?: PartyRole; kind?: "client" | "vendor" | null }[];
  rows: PlasticsLogRow[];
  currency: string;
  locale: string;
  /** Lifted to the page header, next to the title — same row Documents puts "Issue an invoice" in. */
  showForm: boolean;
  onShowFormChange: (showForm: boolean) => void;
}) {
  const [search, setSearch] = useState("");

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.material, r.grade, r.reference, r.party_name]
        .filter((v): v is string => Boolean(v))
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="relative min-w-[240px] max-w-[400px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" strokeWidth={1.75} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search purchases & sales…"
            className={searchInputClass}
          />
        </div>
        {showForm && (
          <ActivityForm parties={parties} currency={currency} locale={locale} onDone={() => onShowFormChange(false)} />
        )}
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-line-soft text-[12px] uppercase tracking-wide text-ink-3">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">What</th>
              <th className="px-5 py-3 font-medium">Party</th>
              <th className="px-5 py-3 font-medium">Amount</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-ink-3">
                  {rows.length === 0 ? "Nothing recorded yet." : "No purchases or sales match your search."}
                </td>
              </tr>
            )}
            {filteredRows.map((r) => (
              <tr key={r.id} className="border-b border-line-soft last:border-b-0 hover:bg-paper">
                <td className="px-5 py-3 font-mono text-ink-2">{r.occurred_on}</td>
                <td className="px-5 py-3 text-ink">
                  <Link href={`/plastics/activities/${r.id}`} className="font-medium text-brand hover:underline">
                    {r.direction === "payable" ? "Purchase" : "Sale"} — {r.material}
                    {r.grade && <span className="ml-1 text-ink-3">({r.grade})</span>}
                  </Link>
                  <span className="ml-2 text-ink-3">{r.net_weight_kg}kg</span>
                </td>
                <td className="px-5 py-3 font-medium text-ink">{r.party_name}</td>
                <td className="px-5 py-3 font-mono text-ink">{formatMoney(r.amount_minor, r.currency, locale)}</td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${STATUS_STYLE[r.status] ?? ""}`}>{r.status}</span>
                </td>
                <td className="px-5 py-3 text-right">
                  <AttachmentButton
                    activityId={r.id}
                    hasAttachment={Boolean(r.attachment_path)}
                    apiBase="/api/plastics/activities"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
