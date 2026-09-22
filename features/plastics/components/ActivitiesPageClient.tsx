"use client";

import { useState } from "react";
import { buttonPrimaryClass } from "@/lib/ui/styles";
import { ActivityLog, type PlasticsLogRow } from "./ActivityLog";
import type { PartyRole } from "@/lib/parties/roles";

/**
 * Owns the "showForm" toggle so "Record a purchase or sale" can sit in the
 * header, next to the title — the same row the Documents pages put "Issue
 * an invoice" in, rather than ActivityLog's own search toolbar a row
 * further down. Mirrors features/activities/components/ActivitiesPageClient.tsx.
 */
export function PlasticsActivitiesPageClient({
  parties,
  rows,
  currency,
  locale,
}: {
  parties: { id: string; name: string; role?: PartyRole }[];
  rows: PlasticsLogRow[];
  currency: string;
  locale: string;
}) {
  const [showForm, setShowForm] = useState(false);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Purchases &amp; sales</h1>
          <p className="mt-1 text-[13.5px] text-ink-2">Material bought from collectors, sold on by grade.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className={showForm ? "text-[13.5px] text-ink-2 hover:text-ink" : buttonPrimaryClass}
        >
          {showForm ? "Cancel" : "Record a purchase or sale"}
        </button>
      </header>

      <ActivityLog
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
