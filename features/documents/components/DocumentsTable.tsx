"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, FileText } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { searchInputClass } from "@/lib/ui/styles";
import { settlementLabel, type DocumentBalance } from "@/lib/documents/settlement";

const TONE: Record<string, string> = {
  settled: "bg-settled-tint text-settled-ink",
  pending: "bg-pending-tint text-pending-ink",
  overdue: "bg-overdue-tint text-overdue",
  muted: "bg-line-soft text-ink-2",
};

export interface DocumentRow {
  id: string;
  doc_kind: string;
  doc_no: string | null;
  party_doc_no: string | null;
  doc_date: string;
  due_date: string | null;
  status: string;
  currency: string;
  total_minor: number;
  party_name: string | null;
  balance: DocumentBalance | null;
}

export function DocumentsTable({
  rows,
  locale,
  today,
  hrefPrefix,
  kindLabel,
  emptyLabel,
  initialFilter = "all",
  pdfHrefPrefix,
}: {
  rows: DocumentRow[];
  locale: string;
  today: string;
  hrefPrefix: string;
  kindLabel: Record<string, string>;
  emptyLabel: string;
  /** Set from a dashboard stat tile's link (`?filter=outstanding` / `?filter=overdue`) so "who all payment is outstanding" is one click, not a hunt through every document. */
  initialFilter?: "all" | "outstanding" | "overdue";
  /** e.g. "/api/documents" — an issued row's PDF opens at `${pdfHrefPrefix}/${id}/pdf`, in a new tab. */
  pdfHrefPrefix?: string;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState(initialFilter);

  const isOverdue = (d: DocumentRow) =>
    d.balance !== null && d.balance.balance_due_minor > 0 && d.due_date !== null && d.due_date < today;
  const isOutstanding = (d: DocumentRow) => d.balance !== null && d.balance.balance_due_minor > 0;

  const filtered = useMemo(() => {
    let out = rows;
    if (filter === "outstanding") out = out.filter(isOutstanding);
    else if (filter === "overdue") out = out.filter(isOverdue);
    const q = search.trim().toLowerCase();
    if (!q) return out;
    return out.filter((d) =>
      [d.doc_no, d.party_doc_no, d.party_name]
        .filter((v): v is string => Boolean(v))
        .some((v) => v.toLowerCase().includes(q)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, filter, today]);

  const outstandingCount = rows.filter(isOutstanding).length;
  const overdueCount = rows.filter(isOverdue).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] max-w-[360px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" strokeWidth={1.75} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents…"
            className={searchInputClass}
          />
        </div>
        <div className="flex gap-1 rounded-md border border-line bg-white p-0.5">
          {(
            [
              ["all", "All"],
              ["outstanding", `Outstanding (${outstandingCount})`],
              ["overdue", `Overdue (${overdueCount})`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
                filter === value
                  ? value === "overdue"
                    ? "bg-overdue text-white"
                    : "bg-ink text-white"
                  : "text-ink-2 hover:bg-paper"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-line-soft text-[12px] uppercase tracking-wide text-ink-3">
              <th className="px-5 py-3 font-medium">Number</th>
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Party</th>
              <th className="px-5 py-3 font-medium">Total</th>
              <th className="px-5 py-3 font-medium">Due</th>
              <th className="px-5 py-3 font-medium">Status</th>
              {pdfHrefPrefix && <th className="px-5 py-3 font-medium"></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={pdfHrefPrefix ? 7 : 6} className="px-5 py-10 text-center text-ink-3">
                  {rows.length === 0
                    ? emptyLabel
                    : filter === "overdue"
                      ? "Nothing overdue."
                      : filter === "outstanding"
                        ? "Nothing outstanding."
                        : "No documents match your search."}
                </td>
              </tr>
            )}
            {filtered.map((d) => {
              const state = settlementLabel(d.balance, d.status);
              const overdue =
                d.balance !== null && d.balance.balance_due_minor > 0 && d.due_date !== null && d.due_date < today;
              const tone = overdue ? "overdue" : state.tone;
              return (
                <tr key={d.id} className="border-b border-line-soft last:border-b-0 hover:bg-paper">
                  <td className="px-5 py-3">
                    <Link href={`${hrefPrefix}/${d.id}`} className="font-mono font-medium text-brand hover:underline">
                      {d.doc_no ?? d.party_doc_no ?? "—"}
                    </Link>
                    <span className="ml-2 text-[12px] text-ink-3">{kindLabel[d.doc_kind] ?? d.doc_kind}</span>
                  </td>
                  <td className="px-5 py-3 font-mono text-ink-2">{d.doc_date}</td>
                  <td className="px-5 py-3 font-medium text-ink">{d.party_name ?? "—"}</td>
                  <td className="px-5 py-3 font-mono text-ink">{formatMoney(d.total_minor, d.currency, locale)}</td>
                  <td className="px-5 py-3 font-mono">
                    {d.balance === null || d.balance.balance_due_minor <= 0 ? (
                      <span className="text-ink-3">—</span>
                    ) : (
                      <span className={overdue ? "text-overdue" : "text-ink"}>
                        {formatMoney(d.balance.balance_due_minor, d.currency, locale)}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${TONE[tone]}`}>
                      {overdue ? "Overdue" : state.label}
                    </span>
                  </td>
                  {pdfHrefPrefix && (
                    <td className="px-5 py-3 text-right">
                      {d.status === "issued" && (
                        <a
                          href={`${pdfHrefPrefix}/${d.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          title="Open PDF"
                          className="inline-flex text-ink-3 hover:text-brand"
                        >
                          <FileText className="size-4" strokeWidth={1.75} />
                        </a>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
