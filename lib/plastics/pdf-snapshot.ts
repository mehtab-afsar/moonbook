import type { DocumentSnapshot } from "@/lib/pdf/snapshot";

/**
 * Same shortcut as the logistics ledger's buildLogisticsSnapshot, and the
 * same cost: `plastics_documents.issued_snapshot` exists as a column but is
 * never written by anything, so this assembles the shape DocumentPdf expects
 * from live rows instead. If this business's tax settings change after a
 * bill is issued, its PDF today reflects the new settings, not the ones in
 * force when it was sent — closing that gap means actually writing
 * issued_snapshot at issue time, not patching it here.
 */
export function buildPlasticsSnapshot(input: {
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
