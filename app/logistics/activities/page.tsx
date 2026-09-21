import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { ActivityLog, type LogisticsLogRow } from "@/features/logistics/components/ActivityLog";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trips & charges" };

export default async function LogisticsActivitiesPage() {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");
  if (auth.ctx.vertical !== "logistics") redirect("/dashboard");

  const supabase = await createClient();
  const [{ data: org }, { data: parties }, { data: activities, error }] = await Promise.all([
    supabase.from("organisations").select("base_currency, locale").eq("id", auth.ctx.orgId).single(),
    supabase.from("parties").select("id, name").order("name"),
    supabase
      .from("logistics_activities")
      .select(
        "id, direction, occurred_on, origin, destination, vendor_ref, reference, amount_minor, direct_cost_minor, currency, status, party_id, bill_to_party_id, parties!logistics_activities_party_org_fk(name)",
      )
      .order("occurred_on", { ascending: false })
      .limit(100),
  ]);

  if (error) throw new Error(`Could not load activities: ${error.message}`);

  const currency = org?.base_currency ?? "INR";
  const locale = org?.locale ?? "en";

  const rows: LogisticsLogRow[] = (activities ?? []).map((a) => {
    const row = a as unknown as {
      id: string; direction: "receivable" | "payable"; occurred_on: string;
      origin: string | null; destination: string | null; vendor_ref: string | null;
      reference: string | null; amount_minor: number; direct_cost_minor: number | null;
      currency: string; status: string;
      parties: { name: string } | null;
    };
    return {
      id: row.id, direction: row.direction, occurred_on: row.occurred_on,
      origin: row.origin, destination: row.destination, vendor_ref: row.vendor_ref,
      reference: row.reference, amount_minor: row.amount_minor,
      direct_cost_minor: row.direct_cost_minor, currency: row.currency, status: row.status,
      party_name: row.parties?.name ?? "—",
    };
  });

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Trips & charges</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">
          What this business actually did — trips you bill for, and charges vendors bill you for.
        </p>
      </header>

      <ActivityLog parties={parties ?? []} rows={rows} currency={currency} locale={locale} />
    </div>
  );
}
