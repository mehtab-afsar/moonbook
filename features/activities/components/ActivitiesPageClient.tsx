"use client";

import { useState } from "react";
import { buttonPrimaryClass } from "@/lib/ui/styles";
import type { ActivityTypeOption } from "./ActivityForm";
import { ActivityLog, type LogRow } from "./ActivityLog";
import type { PartyRole } from "@/lib/parties/roles";

/**
 * Owns the "showForm" toggle so "Record a service" can sit in the header,
 * next to the title — the same row the Documents pages put "Issue an
 * invoice" in, rather than ActivityLog's own search toolbar a row further down.
 */
export function ActivitiesPageClient({
  types,
  parties,
  rows,
  currency,
  locale,
}: {
  types: ActivityTypeOption[];
  parties: { id: string; name: string; role?: PartyRole }[];
  rows: LogRow[];
  currency: string;
  locale: string;
}) {
  const [showForm, setShowForm] = useState(false);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Activity log</h1>
          <p className="mt-1 text-[13.5px] text-ink-2">
            What this business actually did. The fields below come from how you&apos;ve set your
            activity types up — they are not the same for every business on Moonbook.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className={showForm ? "text-[13.5px] text-ink-2 hover:text-ink" : buttonPrimaryClass}
        >
          {showForm ? "Cancel" : "Record a service"}
        </button>
      </header>

      <ActivityLog
        types={types}
        parties={parties}
        rows={rows}
        currency={currency}
        locale={locale}
        showForm={showForm}
        onShowFormChange={setShowForm}
      />
    </>
  );
}
