import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import type { BillableActivity, PartyOption } from "@/features/logistics/components/IssueForm";
import type { VendorService } from "@/features/logistics/components/VendorPaymentForm";
import type { OpenDocument } from "@/features/logistics/components/ReceiptForm";
import { DocumentsNewTabs } from "@/features/logistics/components/DocumentsNewTabs";
import { computePartyRoles } from "@/lib/parties/roles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoices" };

export default async function NewLogisticsInvoicePage() {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");
  if (auth.ctx.vertical !== "logistics") redirect("/dashboard");
  if (auth.ctx.role !== "owner") redirect("/logistics/documents");

  const supabase = await createClient();
  const [
    { data: org },
    { data: parties },
    { data: receivableActivities, error },
    { data: assignedServices },
    { data: openBills },
    { data: directions },
  ] = await Promise.all([
    supabase.from("organisations").select("locale, timezone, base_currency").eq("id", auth.ctx.orgId).single(),
    supabase.from("parties").select("id, name, payment_terms_days, kind").order("name"),
    supabase
      .from("logistics_activities")
      .select("id, occurred_on, reference, amount_minor, currency, party_id, bill_to_party_id, origin, destination")
      .eq("status", "completed")
      .eq("direction", "receivable")
      .order("occurred_on", { ascending: false }),
    // Services assigned to a vendor — shown as an optional reference note
    // when paying that vendor, not billable line items themselves.
    supabase
      .from("logistics_activities")
      .select("id, occurred_on, origin, destination, assigned_vendor_id")
      .eq("direction", "receivable")
      .not("assigned_vendor_id", "is", null)
      .order("occurred_on", { ascending: false }),
    supabase
      .from("logistics_document_balances")
      .select("document_id, counterparty_id, doc_no, doc_date, due_date, currency, balance_due_minor")
      .eq("direction", "payable")
      .gt("balance_due_minor", 0),
    supabase.from("logistics_documents").select("counterparty_id, direction"),
  ]);
  if (error) throw new Error(`Could not load billable work: ${error.message}`);

  const roleByParty = computePartyRoles(
    (directions ?? []) as { counterparty_id: string; direction: string }[],
  );
  const partiesWithRole = ((parties ?? []) as PartyOption[]).map((p) => ({
    ...p,
    role: roleByParty.get(p.id),
    kind: p.kind as "client" | "vendor" | null,
  }));

  const byParty: Record<string, BillableActivity[]> = {};
  for (const a of receivableActivities ?? []) {
    const billTo = a.bill_to_party_id ?? a.party_id;
    (byParty[billTo] ??= []).push({
      id: a.id, label: `${a.origin ?? "—"} → ${a.destination ?? "—"}`,
      occurred_on: a.occurred_on, reference: a.reference, amount_minor: a.amount_minor, currency: a.currency,
    });
  }

  const servicesByVendor: Record<string, VendorService[]> = {};
  for (const a of assignedServices ?? []) {
    const vendorId = a.assigned_vendor_id as string;
    (servicesByVendor[vendorId] ??= []).push({
      id: a.id, label: `${a.origin ?? "—"} → ${a.destination ?? "—"}`, occurred_on: a.occurred_on,
    });
  }

  const openBillsByParty: Record<string, OpenDocument[]> = {};
  for (const d of openBills ?? []) {
    const key = d.counterparty_id as string;
    (openBillsByParty[key] ??= []).push({
      id: d.document_id as string,
      doc_no: (d.doc_no as string) ?? "—",
      doc_date: d.doc_date as string,
      due_date: d.due_date as string | null,
      currency: d.currency as string,
      balance_due_minor: d.balance_due_minor ?? 0,
    });
  }

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: org?.timezone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-8">
      <header>
        <Link href="/logistics/documents" className="text-[13px] text-ink-2 hover:text-ink">← Invoices</Link>
        <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.01em] text-ink">Invoices</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">
          Issue an invoice for work you did, or pay a vendor — against a bill you&apos;ve already
          recorded, or a fresh charge from their own invoice.
        </p>
      </header>
      <DocumentsNewTabs
        parties={partiesWithRole}
        activitiesByParty={byParty}
        servicesByVendor={servicesByVendor}
        openBillsByParty={openBillsByParty}
        locale={org?.locale ?? "en"}
        today={today}
        defaultCurrency={org?.base_currency ?? "INR"}
      />
    </div>
  );
}
