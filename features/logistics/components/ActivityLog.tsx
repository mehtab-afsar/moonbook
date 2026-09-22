"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { searchInputClass } from "@/lib/ui/styles";
import { ActivityForm } from "@/features/logistics/components/ActivityForm";
import { AttachmentButton } from "@/features/activities/components/AttachmentButton";
import type { PartyRole } from "@/lib/parties/roles";

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
  attachment_path: string | null;
}

export function ActivityLog({
  parties,
  originSuggestions,
  destinationSuggestions,
  rows,
  currency,
  locale,
  showForm,
  onShowFormChange,
}: {
  parties: { id: string; name: string; role?: PartyRole; kind?: "client" | "vendor" | null }[];
  originSuggestions: string[];
  destinationSuggestions: string[];
  rows: LogisticsLogRow[];
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
      [r.origin, r.destination, r.vendor_ref, r.reference, r.party_name]
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
            placeholder="Search services…"
            className={searchInputClass}
          />
        </div>
        {showForm && (
          <ActivityForm
            parties={parties} originSuggestions={originSuggestions} destinationSuggestions={destinationSuggestions}
            currency={currency} locale={locale} onDone={() => onShowFormChange(false)}
          />
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
              <th className="px-5 py-3 font-medium">Margin</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-ink-3">
                  {rows.length === 0 ? "Nothing recorded yet." : "No services match your search."}
                </td>
              </tr>
            )}
            {filteredRows.map((r) => (
              <tr key={r.id} className="border-b border-line-soft last:border-b-0 hover:bg-paper">
                <td className="px-5 py-3 font-mono text-ink-2">{r.occurred_on}</td>
                <td className="px-5 py-3 text-ink">
                  <Link href={`/logistics/activities/${r.id}`} className="font-medium text-brand hover:underline">
                    {r.direction === "receivable"
                      ? `${r.origin ?? "—"} → ${r.destination ?? "—"}`
                      : `Vendor charge${r.vendor_ref ? ` · ${r.vendor_ref}` : ""}`}
                  </Link>
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
                <td className="px-5 py-3 text-right">
                  <AttachmentButton
                    activityId={r.id}
                    hasAttachment={Boolean(r.attachment_path)}
                    apiBase="/api/logistics/activities"
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
