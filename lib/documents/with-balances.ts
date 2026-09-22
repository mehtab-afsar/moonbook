import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { settlementLabel, type DocumentBalance } from "@/lib/documents/settlement";

export type { DocumentBalance };
export { settlementLabel };

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
