"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { searchInputClass } from "@/lib/ui/styles";
import { ExpenseForm } from "@/features/expenses/components/ExpenseForm";

export interface ExpenseRow {
  id: string;
  category: string;
  description: string | null;
  currency: string;
  amount_minor: number;
  incurred_on: string;
  party_name: string | null;
}

export function ExpensesPanel({
  parties,
  expenses,
  currency,
  locale,
  today,
  showForm,
  onShowFormChange,
}: {
  parties: { id: string; name: string }[];
  expenses: ExpenseRow[];
  currency: string;
  locale: string;
  today: string;
  /** Lifted to the page header, next to the title — same row Documents puts "Issue an invoice" in. */
  showForm: boolean;
  onShowFormChange: (showForm: boolean) => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return expenses;
    return expenses.filter((e) =>
      [e.category, e.description, e.party_name]
        .filter((v): v is string => Boolean(v))
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [expenses, search]);

  const total = filtered.reduce((sum, e) => sum + e.amount_minor, 0);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="relative min-w-[240px] max-w-[400px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" strokeWidth={1.75} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search expenses…"
            className={searchInputClass}
          />
        </div>
        {showForm && (
          <ExpenseForm parties={parties} currency={currency} today={today} onDone={() => onShowFormChange(false)} />
        )}
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-line-soft text-[12px] uppercase tracking-wide text-ink-3">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Category</th>
              <th className="px-5 py-3 font-medium">Description</th>
              <th className="px-5 py-3 font-medium">Party</th>
              <th className="px-5 py-3 font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-ink-3">
                  {expenses.length === 0 ? "Nothing logged yet." : "No expenses match your search."}
                </td>
              </tr>
            )}
            {filtered.map((e) => (
              <tr key={e.id} className="border-b border-line-soft last:border-b-0">
                <td className="px-5 py-3 font-mono text-ink-2">{e.incurred_on}</td>
                <td className="px-5 py-3 font-medium text-ink">{e.category}</td>
                <td className="px-5 py-3 text-ink-2">{e.description ?? "—"}</td>
                <td className="px-5 py-3 text-ink-2">{e.party_name ?? "—"}</td>
                <td className="px-5 py-3 font-mono text-ink">{formatMoney(e.amount_minor, e.currency, locale)}</td>
              </tr>
            ))}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr className="border-t border-line font-medium">
                <td colSpan={4} className="px-5 py-3 text-right text-ink-2">Total</td>
                <td className="px-5 py-3 font-mono text-ink">{formatMoney(total, currency, locale)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
