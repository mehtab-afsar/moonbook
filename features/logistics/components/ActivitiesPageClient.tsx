"use client";

import { useState } from "react";
import { buttonPrimaryClass } from "@/lib/ui/styles";
import { ActivityLog, type LogisticsLogRow } from "./ActivityLog";
import type { PartyRole } from "@/lib/parties/roles";

/**
 * Owns the "showForm" toggle so "Record a service" can sit in the header,
 * next to the title — the same row the Documents pages put "Issue an
 * invoice" in, rather than ActivityLog's own search toolbar a row further
 * down. Mirrors features/activities/components/ActivitiesPageClient.tsx.
 */
export function LogisticsActivitiesPageClient({
  parties,
  originSuggestions,
  destinationSuggestions,
  rows,
  currency,
  locale,
}: {
  parties: { id: string; name: string; role?: PartyRole; kind?: "client" | "vendor" | null }[];
  originSuggestions: string[];
  destinationSuggestions: string[];
  rows: LogisticsLogRow[];
  currency: string;
  locale: string;
}) {
  const [showForm, setShowForm] = useState(false);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Services</h1>
          <p className="mt-1 text-[13.5px] text-ink-2">
            The work you&apos;ve done for clients — bill it from Documents once it&apos;s here.
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
        parties={parties}
        originSuggestions={originSuggestions}
        destinationSuggestions={destinationSuggestions}
        rows={rows}
        currency={currency}
        locale={locale}
        showForm={showForm}
        onShowFormChange={setShowForm}
      />
    </>
  );
}
