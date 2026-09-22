"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { searchInputClass } from "@/lib/ui/styles";
import { PartyForm, type PartyDraft } from "@/features/parties/components/PartyForm";

export interface PartyRow extends PartyDraft {
  id: string;
  outstanding_minor: number;
  currency: string | null;
  /**
   * Falls back to this when `kind` is unset (a party added before `kind`
   * existed) — read from transaction history. A party billed payable is a
   * vendor, receivable a client, both is both, neither is "other". Not
   * used for tab placement once `kind` is set; `kind` is what you chose
   * when you added them, and stays put regardless of which direction they
   * later get billed.
   */
  role: "vendor" | "client" | "both" | "other";
}

const ROLE_LABEL: Record<PartyRow["role"], string> = {
  vendor: "Vendor", client: "Client", both: "Vendor & client", other: "—",
};
const ROLE_TONE: Record<PartyRow["role"], string> = {
  vendor: "bg-overdue-tint text-overdue",
  client: "bg-settled-tint text-settled-ink",
  both: "bg-brand-tint text-brand",
  other: "bg-line-soft text-ink-2",
};

/**
 * One tab's list — Clients or Vendors, never both at once. `parties` is
 * already filtered to this tab by the caller.
 */
export function PartyList({
  tab,
  onTabChange,
  parties,
  existingNames,
  taxRegime,
  taxIdKind,
  locale,
  adding,
  onAddingChange,
}: {
  tab: "client" | "vendor";
  onTabChange: (tab: "client" | "vendor") => void;
  parties: PartyRow[];
  existingNames: string[];
  taxRegime: "none" | "single_rate" | "split_rate";
  taxIdKind: string;
  locale: string;
  /** Lifted to the page header, next to the title — same row the Documents pages put "Issue an invoice" in. */
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return parties;
    return parties.filter((p) =>
      [p.name, p.email, p.tax_id, p.phone].filter((v): v is string => Boolean(v)).some((v) => v.toLowerCase().includes(q)),
    );
  }, [parties, search]);

  const colCount = taxRegime === "split_rate" ? 7 : 6;

  return (
    <div className="space-y-5">
      {adding ? (
        <PartyForm
          kind={tab} existingNames={existingNames} taxRegime={taxRegime} taxIdKind={taxIdKind}
          onDone={() => onAddingChange(false)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] max-w-[360px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" strokeWidth={1.75} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${tab === "client" ? "clients" : "vendors"}…`}
              className={searchInputClass}
            />
          </div>
          <div className="flex gap-1 rounded-md border border-line bg-white p-0.5">
            <button
              type="button"
              onClick={() => onTabChange("client")}
              className={`rounded px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
                tab === "client" ? "bg-ink text-white" : "text-ink-2 hover:bg-paper"
              }`}
            >
              Clients
            </button>
            <button
              type="button"
              onClick={() => onTabChange("vendor")}
              className={`rounded px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
                tab === "vendor" ? "bg-ink text-white" : "text-ink-2 hover:bg-paper"
              }`}
            >
              Vendors
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-line-soft text-[12px] uppercase tracking-wide text-ink-3">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Mobile</th>
              {taxRegime === "split_rate" && <th className="px-5 py-3 font-medium">State</th>}
              <th className="px-5 py-3 font-medium">{taxIdKind}</th>
              <th className="px-5 py-3 font-medium">Terms</th>
              <th className="px-5 py-3 font-medium">Outstanding</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-5 py-10 text-center text-ink-3">
                  {parties.length === 0
                    ? `No ${tab === "client" ? "clients" : "vendors"} yet. Add one before recording work for them.`
                    : "No matches for your search."}
                </td>
              </tr>
            )}
            {filtered.map((p) =>
              editingId === p.id ? (
                <tr key={p.id} className="border-b border-line-soft last:border-b-0">
                  <td colSpan={colCount} className="p-3">
                    <PartyForm
                      party={p} kind={tab} existingNames={existingNames} taxRegime={taxRegime} taxIdKind={taxIdKind}
                      onDone={() => setEditingId(null)}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={p.id} className="border-b border-line-soft last:border-b-0 hover:bg-paper">
                  <td className="px-5 py-3">
                    <span className="block font-medium text-ink">{p.name}</span>
                    <span className="flex items-center gap-2">
                      {p.email && <span className="text-[12.5px] text-ink-3">{p.email}</span>}
                      {p.role === "both" && (
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ROLE_TONE.both}`}>
                          {ROLE_LABEL.both}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-mono text-ink-2">{p.phone ?? "—"}</td>
                  {taxRegime === "split_rate" && (
                    <td className="px-5 py-3 font-mono text-ink-2">{p.region_code ?? "—"}</td>
                  )}
                  <td className="px-5 py-3 font-mono text-ink-2">{p.tax_id ?? "—"}</td>
                  <td className="px-5 py-3 font-mono text-ink-2">{p.payment_terms_days}d</td>
                  <td className="px-5 py-3 font-mono text-ink">
                    {p.outstanding_minor > 0 && p.currency
                      ? formatMoney(p.outstanding_minor, p.currency, locale)
                      : <span className="text-ink-3">—</span>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button" onClick={() => setEditingId(p.id)}
                      className="text-[13px] text-brand hover:underline"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
