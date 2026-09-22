"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { searchInputClass } from "@/lib/ui/styles";
import {
  ActivityForm,
  type ActivityTypeOption,
  type EditableActivity,
} from "@/features/activities/components/ActivityForm";
import { AttachmentButton } from "@/features/activities/components/AttachmentButton";
import type { PartyRole } from "@/lib/parties/roles";

/**
 * The log, with a correction path.
 *
 * Only work that has NOT been invoiced can be edited, and the reason is shown
 * rather than the button being silently absent: once an activity is billed,
 * changing it would make the ledger disagree with the invoice's own frozen
 * snapshot, and nothing would report the discrepancy. The remedy is to cancel
 * the document or raise a credit note, both of which leave a trail.
 */
const STATUS_STYLE: Record<string, string> = {
  completed: "bg-settled-tint text-settled-ink",
  invoiced: "bg-line-soft text-ink-2",
  pending: "bg-pending-tint text-pending-ink",
  cancelled: "bg-overdue-tint text-overdue",
};

/**
 * A row in the log. Its status is wider than an editable activity's: the log
 * also shows `invoiced`, which is exactly the state that cannot be edited.
 */
export interface LogRow extends Omit<EditableActivity, "status"> {
  status: "pending" | "completed" | "invoiced" | "cancelled";
  currency: string;
  type_label: string;
  uses_job_margin: boolean;
  party_name: string;
  dim1_value: string | null;
  attachment_path: string | null;
}

export function ActivityLog({
  types,
  parties,
  rows,
  currency,
  locale,
  showForm,
  onShowFormChange,
}: {
  types: ActivityTypeOption[];
  parties: { id: string; name: string; role?: PartyRole }[];
  rows: LogRow[];
  currency: string;
  locale: string;
  /** Lifted to the page header, next to the title — same row Documents puts "Issue an invoice" in. */
  showForm: boolean;
  onShowFormChange: (showForm: boolean) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const row = rows.find((r) => r.id === editingId);
  // Narrowed rather than cast: only a row that is not invoiced can be edited,
  // and the type says so, so an `invoiced` row cannot reach the form at all.
  const editing =
    row && row.status !== "invoiced" ? { ...row, status: row.status } : undefined;

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.type_label, r.party_name, r.reference, r.dim1_value]
        .filter((v): v is string => Boolean(v))
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  return (
    <div className="space-y-6">
      {editing ? (
        <div className="space-y-2">
          <p className="text-[13px] text-ink-2">
            Correcting {editing.type_label} for {editing.party_name}. The whole record is
            replaced, so clear a field to remove it.
          </p>
          <ActivityForm
            types={types}
            parties={parties}
            currency={currency}
            locale={locale}
            editing={editing}
            onDone={() => setEditingId(null)}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="relative min-w-[240px] max-w-[400px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" strokeWidth={1.75} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search activities…"
              className={searchInputClass}
            />
          </div>
          {showForm && (
            <ActivityForm
              types={types}
              parties={parties}
              currency={currency}
              locale={locale}
              onDone={() => onShowFormChange(false)}
            />
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-line-soft text-[12px] uppercase tracking-wide text-ink-3">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">What</th>
              <th className="px-5 py-3 font-medium">Party</th>
              <th className="px-5 py-3 font-medium">Reference</th>
              <th className="px-5 py-3 font-medium">Amount</th>
              <th className="px-5 py-3 font-medium">Margin</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center text-ink-3">
                  {rows.length === 0 ? "Nothing recorded yet." : "No activities match your search."}
                </td>
              </tr>
            )}
            {filteredRows.map((r) => (
              <tr key={r.id} className="border-b border-line-soft last:border-b-0 hover:bg-paper">
                <td className="px-5 py-3 font-mono text-ink-2">{r.occurred_on}</td>
                <td className="px-5 py-3 text-ink">
                  <Link href={`/activities/${r.id}`} className="font-medium text-brand hover:underline">
                    {r.type_label}
                  </Link>
                  {r.dim1_value && <span className="ml-2 text-ink-3">· {r.dim1_value}</span>}
                </td>
                <td className="px-5 py-3 font-medium text-ink">{r.party_name}</td>
                <td className="px-5 py-3 font-mono text-ink-2">{r.reference ?? "—"}</td>
                <td className="px-5 py-3 font-mono text-ink">
                  {formatMoney(r.amount_minor, r.currency, locale)}
                </td>
                <td className="px-5 py-3 font-mono text-ink-2">
                  {r.uses_job_margin && r.direct_cost_minor !== null
                    ? formatMoney(r.amount_minor - r.direct_cost_minor, r.currency, locale)
                    : "—"}
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${STATUS_STYLE[r.status] ?? ""}`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <AttachmentButton activityId={r.id} hasAttachment={Boolean(r.attachment_path)} />
                    {r.status === "invoiced" ? (
                    <span
                      className="text-[12.5px] text-ink-3"
                      title="Billed work cannot be edited — cancel the document or raise a credit note"
                    >
                      billed
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingId(r.id)}
                      className="text-[13px] text-brand hover:underline"
                    >
                      Correct
                    </button>
                  )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
