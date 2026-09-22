"use client";

import { useState } from "react";
import { buttonPrimaryClass } from "@/lib/ui/styles";
import { ExpensesPanel, type ExpenseRow } from "./ExpensesPanel";

/**
 * Owns the "showForm" toggle so "Log an expense" can sit in the header, next
 * to the title — the same row the Documents pages put "Issue an invoice" in,
 * rather than ExpensesPanel's own search toolbar a row further down.
 */
export function ExpensesPageClient({
  parties,
  expenses,
  currency,
  locale,
  today,
}: {
  parties: { id: string; name: string }[];
  expenses: ExpenseRow[];
  currency: string;
  locale: string;
  today: string;
}) {
  const [showForm, setShowForm] = useState(false);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Expenses</h1>
          <p className="mt-1 text-[13.5px] text-ink-2">
            Overhead, not tied to any one job — rent, salaries, subscriptions. What a
            specific piece of work cost to deliver is recorded on the activity itself instead.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className={showForm ? "text-[13.5px] text-ink-2 hover:text-ink" : buttonPrimaryClass}
        >
          {showForm ? "Cancel" : "Log an expense"}
        </button>
      </header>

      <ExpensesPanel
        parties={parties}
        expenses={expenses}
        currency={currency}
        locale={locale}
        today={today}
        showForm={showForm}
        onShowFormChange={setShowForm}
      />
    </>
  );
}
