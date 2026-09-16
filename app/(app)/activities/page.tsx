import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { formatMoney } from "@/lib/money";
import { ActivityForm, type ActivityTypeOption } from "@/features/activities/components/ActivityForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity log" };

const STATUS_STYLE: Record<string, string> = {
  completed: "bg-settled-tint text-settled-ink",
  invoiced: "bg-line-soft text-ink-2",
  pending: "bg-pending-tint text-pending-ink",
  cancelled: "bg-overdue-tint text-overdue",
};

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
        "id, occurred_on, amount_minor, currency, reference, status, dim1_key, dim1_value, activity_types!activities_activity_type_id_fkey(label_singular), parties!activities_party_id_fkey(name)",
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

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Activity log</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">
          What this business actually did. The fields below come from how you&apos;ve set your
          activity types up — they are not the same for every business on Moonbook.
        </p>
      </header>

      <ActivityForm
        types={(types ?? []) as unknown as ActivityTypeOption[]}
        parties={parties ?? []}
        currency={currency}
        locale={locale}
      />

      <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-line-soft text-[12px] uppercase tracking-wide text-ink-3">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">What</th>
              <th className="px-5 py-3 font-medium">Party</th>
              <th className="px-5 py-3 font-medium">Reference</th>
              <th className="px-5 py-3 font-medium">Amount</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(activities ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-ink-3">Nothing recorded yet.</td>
              </tr>
            )}
            {(activities ?? []).map((a) => {
              const row = a as unknown as {
                id: string; occurred_on: string; amount_minor: number; currency: string;
                reference: string | null; status: string; dim1_value: string | null;
                activity_types: { label_singular: string } | null;
                parties: { name: string } | null;
              };
              return (
                <tr key={row.id} className="border-b border-line-soft last:border-b-0">
                  <td className="px-5 py-3 font-mono text-ink-2">{row.occurred_on}</td>
                  <td className="px-5 py-3 text-ink">
                    {row.activity_types?.label_singular ?? "—"}
                    {row.dim1_value && <span className="ml-2 text-ink-3">· {row.dim1_value}</span>}
                  </td>
                  <td className="px-5 py-3 font-medium text-ink">{row.parties?.name ?? "—"}</td>
                  <td className="px-5 py-3 font-mono text-ink-2">{row.reference ?? "—"}</td>
                  <td className="px-5 py-3 font-mono text-ink">
                    {formatMoney(row.amount_minor, row.currency, locale)}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${STATUS_STYLE[row.status] ?? ""}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
