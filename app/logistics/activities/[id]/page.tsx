import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Gauge, Package, Truck, UserCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { formatMoney } from "@/lib/money";
import { PartyCard } from "@/features/documents/components/PartyCard";
import { AttachmentButton } from "@/features/activities/components/AttachmentButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Service" };

const STATUS_STYLE: Record<string, string> = {
  completed: "bg-settled-tint text-settled-ink",
  invoiced: "bg-line-soft text-ink-2",
  pending: "bg-pending-tint text-pending-ink",
  cancelled: "bg-overdue-tint text-overdue",
};

export default async function LogisticsActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");
  if (auth.ctx.vertical !== "logistics") redirect("/dashboard");

  const { id } = await params;
  const supabase = await createClient();

  const { data: activity, error } = await supabase
    .from("logistics_activities")
    .select(
      "id, direction, occurred_on, amount_minor, direct_cost_minor, currency, origin, destination, vehicle_no, load_type, distance_km, vendor_ref, reference, notes, status, attachment_path, party:parties!logistics_activities_party_org_fk(name, tax_id, tax_id_kind, region_code, email, phone), bill_to:parties!logistics_activities_bill_to_org_fk(name), assigned_vendor:parties!logistics_activities_assigned_vendor_id_fkey(name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load this service: ${error.message}`);
  if (!activity) notFound();

  const { data: org } = await supabase.from("organisations").select("locale").eq("id", auth.ctx.orgId).single();
  const locale = org?.locale ?? "en";
  const money = (minor: number) => formatMoney(minor, activity.currency, locale);

  const row = activity as unknown as {
    id: string; direction: "receivable" | "payable"; occurred_on: string;
    amount_minor: number; direct_cost_minor: number | null; currency: string;
    origin: string | null; destination: string | null; vehicle_no: string | null;
    load_type: string | null; distance_km: number | null; vendor_ref: string | null;
    reference: string | null; notes: string | null; status: string; attachment_path: string | null;
    party: { name: string; tax_id: string | null; tax_id_kind: string | null; region_code: string | null; email: string | null; phone: string | null } | null;
    bill_to: { name: string } | null;
    assigned_vendor: { name: string } | null;
  };

  const isTrip = row.direction === "receivable";
  const margin =
    isTrip && row.direct_cost_minor !== null ? row.amount_minor - row.direct_cost_minor : null;
  const hasCostSection = row.direct_cost_minor !== null || Boolean(row.bill_to);

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-8">
      <Link href="/logistics/activities" className="text-[13px] text-ink-2 hover:text-ink">← Services</Link>

      <section className="overflow-hidden rounded-[14px] border border-line bg-white">
        <div className="flex flex-wrap items-start justify-between gap-6 p-6">
          <div>
            {isTrip ? (
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[26px] font-semibold tracking-[-0.01em] text-ink">{row.origin ?? "—"}</span>
                <ArrowRight className="size-5 text-ink-3" strokeWidth={2} />
                <span className="text-[26px] font-semibold tracking-[-0.01em] text-ink">{row.destination ?? "—"}</span>
              </div>
            ) : (
              <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">
                Vendor charge{row.vendor_ref ? ` · ${row.vendor_ref}` : ""}
              </h1>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-2.5 text-[13.5px] text-ink-2">
              <span>{row.occurred_on}</span>
              {row.reference && (
                <>
                  <span className="text-ink-3">·</span>
                  <span>Ref {row.reference}</span>
                </>
              )}
              <span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${STATUS_STYLE[row.status] ?? ""}`}>
                {row.status}
              </span>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="text-right">
              <p className="text-[11.5px] uppercase tracking-wide text-ink-3">Amount</p>
              <p className="mt-1 font-mono text-[26px] font-semibold text-ink">{money(row.amount_minor)}</p>
              {margin !== null && <p className="mt-0.5 text-[12.5px] text-ink-3">Margin {money(margin)}</p>}
            </div>
            <AttachmentButton
              activityId={row.id}
              hasAttachment={Boolean(row.attachment_path)}
              apiBase="/api/logistics/activities"
            />
          </div>
        </div>
      </section>

      <div className={`grid gap-4 ${hasCostSection ? "min-[640px]:grid-cols-2" : ""}`}>
        <PartyCard
          label={row.direction === "payable" ? "Vendor" : "Client"}
          name={row.party?.name ?? "—"}
          taxId={row.party?.tax_id}
          taxIdKind={row.party?.tax_id_kind}
          regionCode={row.party?.region_code}
          email={row.party?.email}
          phone={row.party?.phone}
        />
        {hasCostSection && (
          <section className="rounded-[10px] border border-line bg-white p-5">
            <h2 className="text-[13px] font-medium text-ink-2">Cost &amp; billing</h2>
            <dl className="mt-3 space-y-1.5 text-[13.5px]">
              {row.direct_cost_minor !== null && <Row label="Direct cost" value={money(row.direct_cost_minor)} />}
              {margin !== null && <Row label="Margin" value={money(margin)} strong />}
              {row.bill_to && <Row label="Billed to" value={row.bill_to.name} />}
            </dl>
          </section>
        )}
      </div>

      {(row.vehicle_no || row.load_type || row.distance_km !== null || row.assigned_vendor || row.notes) && (
        <section className="rounded-[10px] border border-line bg-white p-5">
          <h2 className="text-[13px] font-medium text-ink-2">Trip details</h2>
          <div className="mt-3 grid gap-3 min-[480px]:grid-cols-2 min-[900px]:grid-cols-4">
            {row.vehicle_no && <StatChip icon={Truck} label="Vehicle" value={row.vehicle_no} />}
            {row.load_type && <StatChip icon={Package} label="Load type" value={row.load_type} />}
            {row.distance_km !== null && <StatChip icon={Gauge} label="Distance" value={`${row.distance_km} km`} />}
            {row.assigned_vendor && (
              <StatChip icon={UserCircle} label="Assigned vendor" value={row.assigned_vendor.name} />
            )}
          </div>
          {row.notes && (
            <div className="mt-4 border-t border-line-soft pt-4">
              <p className="text-[11px] uppercase tracking-wide text-ink-3">Notes</p>
              <p className="mt-1 text-[13.5px] text-ink">{row.notes}</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? "border-t border-line-soft pt-1.5" : ""}`}>
      <dt className="text-ink-2">{label}</dt>
      <dd className={`font-mono text-ink ${strong ? "font-semibold" : ""}`}>{value}</dd>
    </div>
  );
}

function StatChip({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[8px] border border-line-soft bg-paper p-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-ink-3" strokeWidth={1.75} />
      <div>
        <p className="text-[11px] uppercase tracking-wide text-ink-3">{label}</p>
        <p className="text-[13.5px] font-medium text-ink">{value}</p>
      </div>
    </div>
  );
}
