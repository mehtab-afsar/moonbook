"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import { buttonPrimaryClass } from "@/lib/ui/styles";
import { PartyForm, type PartyDraft } from "@/features/parties/components/PartyForm";

export interface PartyRow extends PartyDraft {
  id: string;
  outstanding_minor: number;
  currency: string | null;
}

/**
 * The list, with add and edit inline.
 *
 * Outstanding comes from `party_outstanding`, which groups by direction AND
 * currency — so a party billed in two currencies shows two figures rather than
 * one blended number that would need an exchange rate to mean anything.
 */
export function PartyList({
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
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      {adding ? (
        <PartyForm taxRegime={taxRegime} taxIdKind={taxIdKind} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={buttonPrimaryClass}>
          Add a party
        </button>
      )}

      <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-line-soft text-[12px] uppercase tracking-wide text-ink-3">
              <th className="px-5 py-3 font-medium">Name</th>
              {taxRegime === "split_rate" && <th className="px-5 py-3 font-medium">State</th>}
              <th className="px-5 py-3 font-medium">{taxIdKind}</th>
              <th className="px-5 py-3 font-medium">Terms</th>
              <th className="px-5 py-3 font-medium">Outstanding</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {parties.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-ink-3">
                  No customers yet. Add one before recording work for them.
                </td>
              </tr>
            )}
            {parties.map((p) =>
              editingId === p.id ? (
                <tr key={p.id} className="border-b border-line-soft last:border-b-0">
                  <td colSpan={6} className="p-3">
                    <PartyForm
                      party={p} taxRegime={taxRegime} taxIdKind={taxIdKind}
                      onDone={() => setEditingId(null)}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={p.id} className="border-b border-line-soft last:border-b-0 hover:bg-paper">
                  <td className="px-5 py-3">
                    <span className="block font-medium text-ink">{p.name}</span>
                    {p.email && <span className="block text-[12.5px] text-ink-3">{p.email}</span>}
                  </td>
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
