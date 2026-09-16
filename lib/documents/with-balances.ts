import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Attach each document's balance, fetched SEPARATELY and merged in memory.
 *
 * This is not a stylistic choice. PostgREST can only embed across a real
 * foreign key, and `document_balances` is a view, so
 * `.select("...document_balances(...)")` on `documents` fails with PGRST200 —
 * and it fails as an ERROR, not as a degraded result. A route that
 * destructures `{ data }` without `error` then renders an empty list forever
 * and looks like a business with no invoices.
 *
 * That exact bug shipped in LedgerFlow. Two queries and a Map is the price of
 * never shipping it again. See CONVENTIONS.md section 11.
 */
export interface DocumentBalance {
  total_minor: number;
  settled_minor: number;
  credited_minor: number;
  balance_due_minor: number;
}

export async function attachBalances<T extends { id: string }>(
  supabase: SupabaseClient,
  documents: T[],
): Promise<(T & { balance: DocumentBalance | null })[]> {
  if (documents.length === 0) return [];

  const { data, error } = await supabase
    .from("document_balances")
    .select("document_id, total_minor, settled_minor, credited_minor, balance_due_minor")
    .in("document_id", documents.map((d) => d.id));

  // Thrown, not swallowed: a missing balance renders as a plausible-looking
  // zero, which is the worst possible way for this to fail.
  if (error) throw new Error(`Could not load document balances: ${error.message}`);

  const byId = new Map(
    (data ?? []).map((b) => [
      b.document_id as string,
      {
        total_minor: b.total_minor ?? 0,
        settled_minor: b.settled_minor ?? 0,
        credited_minor: b.credited_minor ?? 0,
        balance_due_minor: b.balance_due_minor ?? 0,
      },
    ]),
  );

  return documents.map((d) => ({ ...d, balance: byId.get(d.id) ?? null }));
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
