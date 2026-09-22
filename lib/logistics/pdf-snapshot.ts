import type { DocumentSnapshot } from "@/lib/pdf/snapshot";

/**
 * The logistics ledger has no `issued_snapshot` — it reads live, a known gap
 * noted in the fork's own schema migration ("a real gap to close before this
 * fork can make the shared engine's 'never rewrites a document already sent'
 * guarantee"). Rather than fork `DocumentPdf` too, this assembles the exact
 * shape it already expects from live rows, so the same renderer serves both
 * ledgers. The cost of that shortcut is real and worth stating plainly: if
 * this business's tax settings change after a bill is issued, its PDF today
 * would reflect the new settings, not the ones in force when it was sent —
 * the shared ledger's frozen snapshot exists specifically to prevent that.
 */
export function buildLogisticsSnapshot(input: {
  document: {
    id: string; direction: string; doc_kind: string; doc_no: string | null;
    party_doc_no: string | null; doc_date: string; due_date: string | null;
    currency: string; taxable_value_minor: number; total_minor: number;
    tax_treatment: string; notes: string | null;
  };
  lines: { description: string; amount_minor: number }[];
  taxes: { component_code: string; component_label: string; rate_pct: number; amount_minor: number }[];
  counterparty: {
    name: string; tax_id: string | null; tax_id_kind: string | null;
    address: string | null; region_code: string | null;
  };
  organisation: {
    legal_name: string; tax_id: string | null; tax_id_kind: string | null;
    region_code: string | null; address: string | null; locale: string; base_currency: string;
  };
}): DocumentSnapshot {
  return {
    document: { ...input.document, round_off_minor: 0 },
    lines: input.lines.map((l) => ({ ...l, discount_minor: 0, printable_details: [] })),
    taxes: input.taxes.map((t, i) => ({ ...t, sort_order: i })),
    counterparty: input.counterparty,
    ship_to: null,
    organisation: input.organisation,
  };
}
