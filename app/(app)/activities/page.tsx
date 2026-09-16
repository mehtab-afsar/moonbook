import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import type { ActivityTypeOption } from "@/features/activities/components/ActivityForm";
import { ActivityLog, type LogRow } from "@/features/activities/components/ActivityLog";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity log" };

export default async function ActivitiesPage() {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");

  const supabase = await createClient();
  const [
    { data: org },
    { data: types, error: typesError },
    { data: parties },
    { data: activities, error: activitiesError },
  ] = await Promise.all([
    supabase.from("organisations").select("base_currency, locale").eq("id", auth.ctx.orgId).single(),
    supabase
      .from("activity_types")
      // The embed names its foreign key explicitly. activity_fields reaches
      // activity_types by TWO paths — the plain activity_type_id FK and the
      // composite (activity_type_id, org_id) one that pins a field to its
      // type's own organisation — and an ambiguous embed is a PostgREST
      // ERROR, not a degraded result. Left unnamed, this query returns
      // nothing and the page renders "no activity types" forever.
      .select("id, label_singular, direction, pricing_strategy, pricing_config, activity_fields!activity_fields_activity_type_id_fkey(key, label, field_type, options, is_required, archived_at, sort_order)")
      .not("org_id", "is", null)
      .is("archived_at", null)
      .order("sort_order"),
    supabase.from("parties").select("id, name").order("name"),
    supabase
      .from("activities")
      // Both embeds name their key. activities reaches activity_types by
      // three foreign keys (the plain one plus the two composite ones that
      // pin direction and org) and parties by two (party_id and
      // bill_to_party_id). Unnamed, either is an ambiguous-embed ERROR.
      .select(
        "id, activity_type_id, party_id, bill_to_party_id, occurred_on, amount_minor, currency, reference, status, details, dim1_key, dim1_value, activity_types!activities_activity_type_id_fkey(label_singular), parties!activities_party_id_fkey(name)",
      )
      .order("occurred_on", { ascending: false })
      .limit(100),
  ]);

  // Surfaced rather than swallowed: an empty list and a failed query look
  // identical on screen, and the failure is the one worth knowing about.
  if (typesError) throw new Error(`Could not load activity types: ${typesError.message}`);
  if (activitiesError) throw new Error(`Could not load activities: ${activitiesError.message}`);

  const currency = org?.base_currency ?? "USD";
  const locale = org?.locale ?? "en";

  const rows: LogRow[] = (activities ?? []).map((a) => {
    const row = a as unknown as {
      id: string; activity_type_id: string; party_id: string;
      bill_to_party_id: string | null; occurred_on: string;
      amount_minor: number; currency: string; reference: string | null; status: string;
      details: Record<string, unknown> | null; dim1_value: string | null;
      activity_types: { label_singular: string } | null;
      parties: { name: string } | null;
    };
    return {
      id: row.id,
      activity_type_id: row.activity_type_id,
      party_id: row.party_id,
      bill_to_party_id: row.bill_to_party_id,
      occurred_on: row.occurred_on,
      reference: row.reference,
      amount_minor: row.amount_minor,
      status: row.status as LogRow["status"],
      details: row.details ?? {},
      currency: row.currency,
      type_label: row.activity_types?.label_singular ?? "—",
      party_name: row.parties?.name ?? "—",
      dim1_value: row.dim1_value,
    };
  });

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Activity log</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">
          What this business actually did. The fields below come from how you&apos;ve set your
          activity types up — they are not the same for every business on Moonbook.
        </p>
      </header>

      <ActivityLog
        types={(types ?? []) as unknown as ActivityTypeOption[]}
        parties={parties ?? []}
        rows={rows}
        currency={currency}
        locale={locale}
      />
    </div>
  );
}
