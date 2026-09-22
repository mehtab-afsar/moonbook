import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { formatMoney } from "@/lib/money";
import { PartyCard } from "@/features/documents/components/PartyCard";
import { AttachmentButton } from "@/features/activities/components/AttachmentButton";
import { LinkedActivities, type LinkedActivityRow, type AvailableLinkType } from "@/features/activities/components/LinkedActivities";

export const dynamic = "force-dynamic";
export const metadata = { title: "Service" };

const STATUS_STYLE: Record<string, string> = {
  completed: "bg-settled-tint text-settled-ink",
  invoiced: "bg-line-soft text-ink-2",
  pending: "bg-pending-tint text-pending-ink",
  cancelled: "bg-overdue-tint text-overdue",
};

export default async function ActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");

  const { id } = await params;
  const supabase = await createClient();

  const { data: activity, error } = await supabase
    .from("activities")
    .select(
      "id, activity_type_id, occurred_on, amount_minor, direct_cost_minor, currency, reference, status, details, dim1_key, dim1_value, attachment_path, activity_types!activities_activity_type_id_fkey(label_singular, uses_job_margin), party:parties!activities_party_id_fkey(name, tax_id, tax_id_kind, region_code, email, phone), bill_to:parties!activities_bill_to_party_id_fkey(name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load this activity: ${error.message}`);
  if (!activity) notFound();

  const { data: org } = await supabase.from("organisations").select("locale").eq("id", auth.ctx.orgId).single();
  const locale = org?.locale ?? "en";
  const money = (minor: number) => formatMoney(minor, activity.currency, locale);

  const row = activity as unknown as {
    id: string; activity_type_id: string; occurred_on: string; amount_minor: number; direct_cost_minor: number | null;
    currency: string; reference: string | null; status: string;
    details: Record<string, unknown> | null; dim1_key: string | null; dim1_value: string | null;
    attachment_path: string | null;
    activity_types: { label_singular: string; uses_job_margin: boolean } | null;
    party: { name: string; tax_id: string | null; tax_id_kind: string | null; region_code: string | null; email: string | null; phone: string | null } | null;
    bill_to: { name: string } | null;
  };

  const typeLabel = row.activity_types?.label_singular ?? "Activity";
  const margin =
    row.activity_types?.uses_job_margin && row.direct_cost_minor !== null
      ? row.amount_minor - row.direct_cost_minor
      : null;
  const detailEntries = Object.entries(row.details ?? {}).filter(([, v]) => v !== null && v !== "");

  const [{ data: availableLinkTypesRaw }, { data: outgoingLinks }, { data: incomingLinks }] = await Promise.all([
    supabase
      .from("activity_link_types")
      .select("id, label, aggregate, to_activity_type_id")
      .eq("org_id", auth.ctx.orgId)
      .eq("from_activity_type_id", row.activity_type_id)
      .is("archived_at", null)
      .order("sort_order"),
    supabase
      .from("activity_links")
      .select(
        "id, activity_link_types(label, aggregate), to_activity:activities!activity_links_to_activity_id_fkey(id, occurred_on, reference, amount_minor, currency, activity_types!activities_activity_type_id_fkey(label_singular))",
      )
      .eq("from_activity_id", id),
    supabase
      .from("activity_links")
      .select(
        "id, activity_link_types(label, aggregate), from_activity:activities!activity_links_from_activity_id_fkey(id, occurred_on, reference, amount_minor, currency, activity_types!activities_activity_type_id_fkey(label_singular))",
      )
      .eq("to_activity_id", id),
  ]);

  const availableLinkTypes: AvailableLinkType[] = await Promise.all(
    (availableLinkTypesRaw ?? []).map(async (lt) => {
      const { data: candidates } = await supabase
        .from("activities")
        .select("id, occurred_on, reference, activity_types!activities_activity_type_id_fkey(label_singular)")
        .eq("activity_type_id", lt.to_activity_type_id)
        .neq("id", id)
        .order("occurred_on", { ascending: false })
        .limit(50);
      return {
        id: lt.id,
        label: lt.label,
        aggregate: lt.aggregate as AvailableLinkType["aggregate"],
        candidates: (candidates ?? []).map((c) => {
          const ct = (c as unknown as { activity_types: { label_singular: string } | null }).activity_types;
          return { id: c.id, label: `${ct?.label_singular ?? "Activity"} · ${c.occurred_on}${c.reference ? ` · ${c.reference}` : ""}` };
        }),
      };
    }),
  );

  type LinkedTarget = { id: string; occurred_on: string; reference: string | null; amount_minor: number; currency: string; activity_types: { label_singular: string } | null };
  const linkGroups = new Map<string, { linkTypeLabel: string; aggregate: "none" | "sum_amount" | "count"; rows: LinkedActivityRow[] }>();

  for (const l of outgoingLinks ?? []) {
    const lt = (l as unknown as { activity_link_types: { label: string; aggregate: string } | null }).activity_link_types;
    const target = (l as unknown as { to_activity: LinkedTarget | null }).to_activity;
    if (!lt || !target) continue;
    const g = linkGroups.get(lt.label) ?? { linkTypeLabel: lt.label, aggregate: lt.aggregate as "none" | "sum_amount" | "count", rows: [] };
    g.rows.push({
      linkId: l.id, activityId: target.id,
      label: `${target.activity_types?.label_singular ?? "Activity"} · ${target.occurred_on}${target.reference ? ` · ${target.reference}` : ""}`,
      amountMinor: target.amount_minor, currency: target.currency,
    });
    linkGroups.set(lt.label, g);
  }
  for (const l of incomingLinks ?? []) {
    const lt = (l as unknown as { activity_link_types: { label: string; aggregate: string } | null }).activity_link_types;
    const source = (l as unknown as { from_activity: LinkedTarget | null }).from_activity;
    if (!lt || !source) continue;
    const key = `Linked from · ${lt.label}`;
    // Incoming rollups don't apply — the rollup is defined at the OTHER
    // activity, over ITS own outgoing links, not this one's incoming set.
    const g = linkGroups.get(key) ?? { linkTypeLabel: key, aggregate: "none" as const, rows: [] };
    g.rows.push({
      linkId: l.id, activityId: source.id,
      label: `${source.activity_types?.label_singular ?? "Activity"} · ${source.occurred_on}${source.reference ? ` · ${source.reference}` : ""}`,
      amountMinor: source.amount_minor, currency: source.currency,
    });
    linkGroups.set(key, g);
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/activities" className="text-[13px] text-ink-2 hover:text-ink">← Activity log</Link>
          <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.01em] text-ink">
            {typeLabel}
            {row.dim1_value && <span className="ml-2 text-ink-3">· {row.dim1_value}</span>}
          </h1>
          <p className="mt-1 text-[13.5px] text-ink-2">
            {row.occurred_on} · {money(row.amount_minor)}
            {row.reference && <> · Ref {row.reference}</>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${STATUS_STYLE[row.status] ?? ""}`}>
            {row.status}
          </span>
          <AttachmentButton activityId={row.id} hasAttachment={Boolean(row.attachment_path)} />
        </div>
      </header>

      <div className="grid gap-4 min-[640px]:grid-cols-2">
        <PartyCard
          label="Party"
          name={row.party?.name ?? "—"}
          taxId={row.party?.tax_id}
          taxIdKind={row.party?.tax_id_kind}
          regionCode={row.party?.region_code}
          email={row.party?.email}
          phone={row.party?.phone}
        />
        <section className="rounded-[10px] border border-line bg-white p-5">
          <h2 className="text-[13px] font-medium text-ink-2">Amount</h2>
          <p className="mt-1.5 font-mono text-[18px] font-semibold text-ink">{money(row.amount_minor)}</p>
          {row.direct_cost_minor !== null && (
            <p className="mt-1 text-[12.5px] text-ink-3">Direct cost {money(row.direct_cost_minor)}</p>
          )}
          {margin !== null && (
            <p className="mt-1 text-[12.5px] text-ink-3">Margin {money(margin)}</p>
          )}
          {row.bill_to && <p className="mt-1 text-[12.5px] text-ink-3">Billed to {row.bill_to.name}</p>}
        </section>
      </div>

      {detailEntries.length > 0 && (
        <section className="rounded-[10px] border border-line bg-white p-5">
          <h2 className="text-[13px] font-medium text-ink-2">Details</h2>
          <dl className="mt-3 grid gap-x-6 gap-y-2 min-[480px]:grid-cols-2">
            {detailEntries.map(([key, value]) => (
              <div key={key}>
                <dt className="text-[11.5px] uppercase tracking-wide text-ink-3">{key}</dt>
                <dd className="text-[13.5px] text-ink">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <LinkedActivities
        activityId={row.id}
        locale={locale}
        groups={[...linkGroups.values()]}
        availableLinkTypes={availableLinkTypes}
      />
    </div>
  );
}
