import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { PartyList, type PartyRow } from "@/features/parties/components/PartyList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Parties" };

export default async function PartiesPage() {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");

  const supabase = await createClient();
  const [{ data: org }, { data: parties, error }, { data: outstanding }] = await Promise.all([
    supabase
      .from("organisations")
      .select("locale, tax_regime, tax_id_kind, base_currency")
      .eq("id", auth.ctx.orgId)
      .single(),
    supabase
      .from("parties")
      .select("id, name, region_code, tax_id, payment_terms_days, email, phone, address")
      .order("name"),
    // Fetched separately and merged: party_outstanding is a VIEW, and
    // PostgREST cannot embed a view across a foreign key that does not exist.
    // See CONVENTIONS.md section 9.
    supabase
      .from("party_outstanding")
      .select("party_id, direction, currency, amount_outstanding_minor"),
  ]);

  if (error) throw new Error(`Could not load parties: ${error.message}`);

  // Receivables only for now — payables have no UI, by decision, so showing a
  // netted figure would be showing a number nothing else in the app agrees with.
  const owed = new Map<string, { minor: number; currency: string }>();
  for (const row of outstanding ?? []) {
    if (row.direction !== "receivable") continue;
    // A view's columns are all nullable to the generated types, since Postgres
    // cannot prove otherwise through an outer join.
    const minor = row.amount_outstanding_minor ?? 0;
    if (minor <= 0) continue;
    const prev = owed.get(row.party_id as string);
    // A party billed in two currencies would need two rows to be honest; until
    // the UI has somewhere to put both, show the larger and never add them up.
    if (!prev || minor > prev.minor) {
      owed.set(row.party_id as string, { minor, currency: row.currency as string });
    }
  }

  const rows: PartyRow[] = (parties ?? []).map((p) => ({
    ...p,
    outstanding_minor: owed.get(p.id)?.minor ?? 0,
    currency: owed.get(p.id)?.currency ?? org?.base_currency ?? null,
  }));

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Parties</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">
          Everyone you bill. Editing one here never changes an invoice already issued to
          them — those read from their own frozen copy.
        </p>
      </header>

      <PartyList
        parties={rows}
        taxRegime={(org?.tax_regime ?? "none") as "none" | "single_rate" | "split_rate"}
        taxIdKind={org?.tax_id_kind ?? "Tax ID"}
        locale={org?.locale ?? "en"}
      />
    </div>
  );
}
