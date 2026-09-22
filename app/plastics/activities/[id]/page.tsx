import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { formatMoney } from "@/lib/money";
import { PartyCard } from "@/features/documents/components/PartyCard";
import { AttachmentButton } from "@/features/activities/components/AttachmentButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity" };

const STATUS_STYLE: Record<string, string> = {
  completed: "bg-settled-tint text-settled-ink",
  invoiced: "bg-line-soft text-ink-2",
  cancelled: "bg-overdue-tint text-overdue",
};

export default async function PlasticsActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");
  if (auth.ctx.vertical !== "plastics") redirect("/dashboard");

  const { id } = await params;
  const supabase = await createClient();

  const { data: activity, error } = await supabase
    .from("plastics_activities")
    .select(
      "id, direction, occurred_on, amount_minor, direct_cost_minor, currency, material, grade, net_weight_kg, rate_per_kg_minor, ticket_no, vehicle_no, reference, notes, status, attachment_path, party:parties!plastics_activities_party_org_fk(name, tax_id, tax_id_kind, region_code, email, phone), bill_to:parties!plastics_activities_bill_to_org_fk(name), assigned_vendor:parties!plastics_activities_assigned_vendor_id_fkey(name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load this activity: ${error.message}`);
  if (!activity) notFound();

  const { data: org } = await supabase.from("organisations").select("locale").eq("id", auth.ctx.orgId).single();
  const locale = org?.locale ?? "en";
  const money = (minor: number) => formatMoney(minor, activity.currency, locale);

  const row = activity as unknown as {
    id: string; direction: "receivable" | "payable"; occurred_on: string;
    amount_minor: number; direct_cost_minor: number | null; currency: string;
    material: string; grade: string | null; net_weight_kg: number; rate_per_kg_minor: number;
    ticket_no: string | null; vehicle_no: string | null;
    reference: string | null; notes: string | null; status: string; attachment_path: string | null;
    party: { name: string; tax_id: string | null; tax_id_kind: string | null; region_code: string | null; email: string | null; phone: string | null } | null;
    bill_to: { name: string } | null;
    assigned_vendor: { name: string } | null;
  };

  const title = `${row.direction === "payable" ? "Purchase" : "Sale"} — ${row.material}${row.grade ? ` (${row.grade})` : ""}`;

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/plastics/activities" className="text-[13px] text-ink-2 hover:text-ink">← Purchases & sales</Link>
          <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.01em] text-ink">{title}</h1>
          <p className="mt-1 text-[13.5px] text-ink-2">
            {row.occurred_on} · {money(row.amount_minor)}
            {row.reference && <> · Ref {row.reference}</>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${STATUS_STYLE[row.status] ?? ""}`}>
            {row.status}
          </span>
          <AttachmentButton activityId={row.id} hasAttachment={Boolean(row.attachment_path)} apiBase="/api/plastics/activities" />
        </div>
      </header>

      <div className="grid gap-4 min-[640px]:grid-cols-2">
        <PartyCard
          label={row.direction === "payable" ? "Vendor" : "Client"}
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
          <p className="mt-1 text-[12.5px] text-ink-3">{row.net_weight_kg}kg × {money(row.rate_per_kg_minor)}/kg</p>
          {row.bill_to && <p className="mt-1 text-[12.5px] text-ink-3">Billed to {row.bill_to.name}</p>}
        </section>
      </div>

      <section className="rounded-[10px] border border-line bg-white p-5">
        <h2 className="text-[13px] font-medium text-ink-2">Load details</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2 min-[480px]:grid-cols-2">
          {row.ticket_no && (
            <div>
              <dt className="text-[11.5px] uppercase tracking-wide text-ink-3">Weighbridge slip</dt>
              <dd className="text-[13.5px] text-ink">{row.ticket_no}</dd>
            </div>
          )}
          {row.vehicle_no && (
            <div>
              <dt className="text-[11.5px] uppercase tracking-wide text-ink-3">Vehicle</dt>
              <dd className="text-[13.5px] text-ink">{row.vehicle_no}</dd>
            </div>
          )}
          {row.assigned_vendor && (
            <div>
              <dt className="text-[11.5px] uppercase tracking-wide text-ink-3">Assigned vendor</dt>
              <dd className="text-[13.5px] text-ink">{row.assigned_vendor.name}</dd>
            </div>
          )}
          {row.notes && (
            <div className="min-[480px]:col-span-2">
              <dt className="text-[11.5px] uppercase tracking-wide text-ink-3">Notes</dt>
              <dd className="text-[13.5px] text-ink">{row.notes}</dd>
            </div>
          )}
        </dl>
      </section>
    </div>
  );
}
