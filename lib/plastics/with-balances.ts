import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentBalance } from "@/lib/documents/with-balances";

/** The plastics ledger's own balance attachment — see lib/logistics/with-balances.ts. */
export async function attachPlasticsBalances<T extends { id: string }>(
  supabase: SupabaseClient,
  documents: T[],
): Promise<(T & { balance: DocumentBalance | null })[]> {
  if (documents.length === 0) return [];

  const { data, error } = await supabase
    .from("plastics_document_balances")
    .select("document_id, total_minor, settled_minor, balance_due_minor")
    .in("document_id", documents.map((d) => d.id));

  if (error) throw new Error(`Could not load document balances: ${error.message}`);

  const byId = new Map(
    (data ?? []).map((b) => [
      b.document_id as string,
      {
        total_minor: b.total_minor ?? 0,
        settled_minor: b.settled_minor ?? 0,
        credited_minor: 0,
        balance_due_minor: b.balance_due_minor ?? 0,
      },
    ]),
  );

  return documents.map((d) => ({ ...d, balance: byId.get(d.id) ?? null }));
}
