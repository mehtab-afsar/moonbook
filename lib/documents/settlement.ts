/**
 * Pure, no server dependency — split out of with-balances.ts so a client
 * component (DocumentsTable) can format a balance it already has without
 * pulling in that file's "server-only" fetch code.
 */
export interface DocumentBalance {
  total_minor: number;
  settled_minor: number;
  credited_minor: number;
  balance_due_minor: number;
}

/**
 * Not every issued document has a balance row: `document_balances` covers
 * invoices and bills only, because a credit note is a SOURCE of an offset and
 * never a target of one. Including notes would double-count them.
 */
export function settlementLabel(
  balance: DocumentBalance | null,
  status: string,
): { label: string; tone: "settled" | "pending" | "overdue" | "muted" } {
  if (status === "cancelled") return { label: "Cancelled", tone: "muted" };
  if (status === "draft") return { label: "Draft", tone: "muted" };
  if (!balance) return { label: "Issued", tone: "muted" };
  if (balance.balance_due_minor <= 0) return { label: "Settled", tone: "settled" };
  if (balance.settled_minor > 0 || balance.credited_minor > 0) {
    return { label: "Part paid", tone: "pending" };
  }
  return { label: "Open", tone: "pending" };
}

/** A payment/receipt's counterpart to settlementLabel — the header pill on a receipt page. */
export function appliedStateLabel(
  appliedMinor: number,
  unappliedMinor: number,
): { label: string; tone: "settled" | "pending" | "overdue" | "muted" } {
  if (unappliedMinor <= 0) return { label: "Fully applied", tone: "settled" };
  if (appliedMinor <= 0) return { label: "Unapplied", tone: "pending" };
  return { label: "Partially applied", tone: "pending" };
}
