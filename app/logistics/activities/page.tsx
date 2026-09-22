import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import type { LogisticsLogRow } from "@/features/logistics/components/ActivityLog";
import { LogisticsActivitiesPageClient } from "@/features/logistics/components/ActivitiesPageClient";
import { computePartyRoles } from "@/lib/parties/roles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Services" };

export default async function LogisticsActivitiesPage() {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");
  if (auth.ctx.vertical !== "logistics") redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: org }, { data: parties }, { data: activities, error }, { data: directions }, { data: places }] = await Promise.all([
    supabase.from("organisations").select("base_currency, locale").eq("id", auth.ctx.orgId).single(),
    supabase.from("parties").select("id, name, kind").order("name"),
    supabase
      .from("logistics_activities")
      // Services only — a vendor charge is no longer logged here as its own
      // row; it's created (and immediately billed) from the Vendor payment
      // tab on Documents. See 20260927000001_logistics_service_vendor_ref.
      .select(
        "id, direction, occurred_on, origin, destination, vendor_ref, reference, amount_minor, direct_cost_minor, currency, status, party_id, bill_to_party_id, attachment_path, parties!logistics_activities_party_org_fk(name)",
      )
      .eq("direction", "receivable")
      .order("occurred_on", { ascending: false })
      .limit(100),
    supabase.from("logistics_documents").select("counterparty_id, direction"),
    // Distinct place names used before, for the origin/destination
    // suggestion lists — capped, most-recent-first, dedup'd client-side.
    supabase
      .from("logistics_activities")
      .select("origin, destination")
      .eq("direction", "receivable")
      .order("occurred_on", { ascending: false })
      .limit(300),
  ]);

  if (error) throw new Error(`Could not load activities: ${error.message}`);

  const originSuggestions = [...new Set((places ?? []).map((p) => p.origin).filter((v): v is string => Boolean(v)))];
  const destinationSuggestions = [...new Set((places ?? []).map((p) => p.destination).filter((v): v is string => Boolean(v)))];

  const currency = org?.base_currency ?? "INR";
  const locale = org?.locale ?? "en";
  const roleByParty = computePartyRoles(
    (directions ?? []) as { counterparty_id: string; direction: string }[],
  );
  const partiesWithRole = (parties ?? []).map((p) => ({
    ...p, role: roleByParty.get(p.id), kind: p.kind as "client" | "vendor" | null,
  }));

  const rows: LogisticsLogRow[] = (activities ?? []).map((a) => {
    const row = a as unknown as {
      id: string; direction: "receivable" | "payable"; occurred_on: string;
      origin: string | null; destination: string | null; vendor_ref: string | null;
      reference: string | null; amount_minor: number; direct_cost_minor: number | null;
      currency: string; status: string; attachment_path: string | null;
      parties: { name: string } | null;
    };
    return {
      id: row.id, direction: row.direction, occurred_on: row.occurred_on,
      origin: row.origin, destination: row.destination, vendor_ref: row.vendor_ref,
      reference: row.reference, amount_minor: row.amount_minor,
      direct_cost_minor: row.direct_cost_minor, currency: row.currency, status: row.status,
      party_name: row.parties?.name ?? "—", attachment_path: row.attachment_path,
    };
  });

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-8">
      <LogisticsActivitiesPageClient
        parties={partiesWithRole}
        originSuggestions={originSuggestions}
        destinationSuggestions={destinationSuggestions}
        rows={rows}
        currency={currency}
        locale={locale}
      />
    </div>
  );
}
