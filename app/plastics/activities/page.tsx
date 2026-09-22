import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import type { PlasticsLogRow } from "@/features/plastics/components/ActivityLog";
import { PlasticsActivitiesPageClient } from "@/features/plastics/components/ActivitiesPageClient";
import { computePartyRoles } from "@/lib/parties/roles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Purchases & sales" };

export default async function PlasticsActivitiesPage() {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");
  if (auth.ctx.vertical !== "plastics") redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: org }, { data: parties }, { data: activities, error }, { data: directions }] = await Promise.all([
    supabase.from("organisations").select("base_currency, locale").eq("id", auth.ctx.orgId).single(),
    supabase.from("parties").select("id, name, kind").order("name"),
    supabase
      .from("plastics_activities")
      .select("id, direction, occurred_on, material, grade, net_weight_kg, reference, amount_minor, currency, status, party_id, bill_to_party_id, attachment_path, parties!plastics_activities_party_org_fk(name)")
      .order("occurred_on", { ascending: false })
      .limit(100),
    supabase.from("plastics_documents").select("counterparty_id, direction"),
  ]);

  if (error) throw new Error(`Could not load activities: ${error.message}`);

  const currency = org?.base_currency ?? "INR";
  const locale = org?.locale ?? "en";
  const roleByParty = computePartyRoles(
    (directions ?? []) as { counterparty_id: string; direction: string }[],
  );
  const partiesWithRole = (parties ?? []).map((p) => ({
    ...p, role: roleByParty.get(p.id), kind: p.kind as "client" | "vendor" | null,
  }));

  const rows: PlasticsLogRow[] = (activities ?? []).map((a) => {
    const row = a as unknown as {
      id: string; direction: "receivable" | "payable"; occurred_on: string;
      material: string; grade: string | null; net_weight_kg: number;
      reference: string | null; amount_minor: number; currency: string; status: string;
      attachment_path: string | null;
      parties: { name: string } | null;
    };
    return {
      id: row.id, direction: row.direction, occurred_on: row.occurred_on,
      material: row.material, grade: row.grade, net_weight_kg: row.net_weight_kg,
      reference: row.reference, amount_minor: row.amount_minor, currency: row.currency,
      status: row.status, party_name: row.parties?.name ?? "—", attachment_path: row.attachment_path,
    };
  });

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-8">
      <PlasticsActivitiesPageClient parties={partiesWithRole} rows={rows} currency={currency} locale={locale} />
    </div>
  );
}
