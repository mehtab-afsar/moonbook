import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import type { PartyRow } from "@/features/parties/components/PartyList";
import { PartiesPageClient } from "@/features/parties/components/PartiesPageClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Parties" };

export default async function PartiesPage() {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");

  // Which table tells us who's a vendor (we've billed payable to them) vs a
  // client (we've billed receivable to them) depends on which ledger this
  // org is on — the shared engine's `documents`, or this vertical's own.
  const documentsTable =
    auth.ctx.vertical === "logistics" ? "logistics_documents"
    : auth.ctx.vertical === "plastics" ? "plastics_documents"
    : "documents";

  const supabase = await createClient();
  const [{ data: org }, { data: parties, error }, { data: outstanding }, { data: directions }] = await Promise.all([
    supabase
      .from("organisations")
      .select("locale, tax_regime, tax_id_kind, base_currency")
      .eq("id", auth.ctx.orgId)
      .single(),
    supabase
      .from("parties")
      .select("id, name, kind, region_code, tax_id, payment_terms_days, email, phone, address, payout_bank_name, payout_account_no, payout_ifsc_or_routing, payout_upi_id")
      .order("name"),
    // Fetched separately and merged: party_outstanding is a VIEW, and
    // PostgREST cannot embed a view across a foreign key that does not exist.
    // See CONVENTIONS.md section 9. Only covers the shared engine today —
    // the forked verticals have no equivalent view yet.
    auth.ctx.vertical === "shared"
      ? supabase.from("party_outstanding").select("party_id, direction, currency, amount_outstanding_minor")
      : Promise.resolve({ data: [] as { party_id: string; direction: string; currency: string; amount_outstanding_minor: number | null }[] }),
    // Vendor vs client is read from transaction history, not stored — a
    // party with only payable documents is a vendor, only receivable a
    // client, both is both. Computed here rather than on the client so a
    // page with hundreds of parties doesn't ship every document row to do it.
    supabase.from(documentsTable).select("counterparty_id, direction"),
  ]);

  if (error) throw new Error(`Could not load parties: ${error.message}`);

  const roleByParty = new Map<string, "vendor" | "client" | "both">();
  for (const d of directions ?? []) {
    const id = d.counterparty_id as string;
    const isPayable = d.direction === "payable";
    const prev = roleByParty.get(id);
    const thisRole = isPayable ? "vendor" : "client";
    if (!prev) roleByParty.set(id, thisRole);
    else if (prev !== thisRole) roleByParty.set(id, "both");
  }

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
    kind: p.kind as "client" | "vendor" | null,
    outstanding_minor: owed.get(p.id)?.minor ?? 0,
    currency: owed.get(p.id)?.currency ?? org?.base_currency ?? null,
    role: roleByParty.get(p.id) ?? "other",
  }));

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-8">
      <PartiesPageClient
        parties={rows}
        taxRegime={(org?.tax_regime ?? "none") as "none" | "single_rate" | "split_rate"}
        taxIdKind={org?.tax_id_kind ?? "Tax ID"}
        locale={org?.locale ?? "en"}
      />
    </div>
  );
}
