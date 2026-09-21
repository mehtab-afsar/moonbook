import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentBalance } from "@/lib/documents/with-balances";

/**
 * The logistics ledger's own balance attachment — same two-query-and-a-Map
 * shape as the shared engine's attachBalances (a view cannot be embedded via
 * a foreign key), pointed at logistics_document_balances instead.
 */
export async function attachLogisticsBalances<T extends { id: string }>(
  supabase: SupabaseClient,
  documents: T[],
): Promise<(T & { balance: DocumentBalance | null })[]> {
  if (documents.length === 0) return [];

  const { data, error } = await supabase
    .from("logistics_document_balances")
    .select("document_id, total_minor, settled_minor, balance_due_minor")
    .in("document_id", documents.map((d) => d.id));

  if (error) throw new Error(`Could not load document balances: ${error.message}`);

  const byId = new Map(
    (data ?? []).map((b) => [
      b.document_id as string,
      {
        total_minor: b.total_minor ?? 0,
        settled_minor: b.settled_minor ?? 0,
        credited_minor: 0, // this ledger has no credit/debit notes yet
        balance_due_minor: b.balance_due_minor ?? 0,
      },
    ]),
  );

  return documents.map((d) => ({ ...d, balance: byId.get(d.id) ?? null }));
}
