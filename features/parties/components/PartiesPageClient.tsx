"use client";

import { useMemo, useState } from "react";
import { buttonPrimaryClass } from "@/lib/ui/styles";
import { PartyList, type PartyRow } from "./PartyList";

/**
 * Two tabs, never merged — Clients and Vendors are separate lists with their
 * own "Add" flow, so a client never quietly shows up while you're looking
 * for a vendor. `kind` (chosen when a party is added) decides which tab it's
 * in; a party added before `kind` existed falls back to its computed role
 * from document history (see PartyList).
 */
export function PartiesPageClient({
  parties,
  taxRegime,
  taxIdKind,
  locale,
}: {
  parties: PartyRow[];
  taxRegime: "none" | "single_rate" | "split_rate";
  taxIdKind: string;
  locale: string;
}) {
  const [tab, setTab] = useState<"client" | "vendor">("client");
  const [adding, setAdding] = useState(false);

  const existingNames = useMemo(() => parties.map((p) => p.name), [parties]);

  const tabParties = useMemo(
    () =>
      parties.filter((p) =>
        p.kind ? p.kind === tab : tab === "client" ? p.role === "client" || p.role === "both" : p.role === "vendor" || p.role === "both",
      ),
    [parties, tab],
  );

  function switchTab(next: "client" | "vendor") {
    setTab(next);
    setAdding(false);
  }

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Parties</h1>
          <p className="mt-1 text-[13.5px] text-ink-2">
            Everyone you bill. Editing one here never changes an invoice already issued to
            them — those read from their own frozen copy.
          </p>
        </div>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className={buttonPrimaryClass}>
            {tab === "client" ? "Add a client" : "Add a vendor"}
          </button>
        )}
      </header>

      <PartyList
        tab={tab}
        onTabChange={switchTab}
        parties={tabParties}
        existingNames={existingNames}
        taxRegime={taxRegime}
        taxIdKind={taxIdKind}
        locale={locale}
        adding={adding}
        onAddingChange={setAdding}
      />
    </>
  );
}
