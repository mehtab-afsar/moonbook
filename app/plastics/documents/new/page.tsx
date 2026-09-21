import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { IssueForm, type BillableActivity, type PartyOption } from "@/features/plastics/components/IssueForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Issue an invoice" };

export default async function NewPlasticsInvoicePage() {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");
  if (auth.ctx.vertical !== "plastics") redirect("/dashboard");
  if (auth.ctx.role !== "owner") redirect("/plastics/documents");

  const supabase = await createClient();
  const [{ data: org }, { data: parties }, { data: activities, error }] = await Promise.all([
    supabase.from("organisations").select("locale, timezone").eq("id", auth.ctx.orgId).single(),
    supabase.from("parties").select("id, name, payment_terms_days").order("name"),
    supabase
      .from("plastics_activities")
      .select("id, occurred_on, reference, amount_minor, currency, party_id, bill_to_party_id, material, net_weight_kg")
      .eq("status", "completed")
      .eq("direction", "receivable")
      .order("occurred_on", { ascending: false }),
  ]);
  if (error) throw new Error(`Could not load billable work: ${error.message}`);

  const byParty: Record<string, BillableActivity[]> = {};
  for (const a of activities ?? []) {
    const billTo = a.bill_to_party_id ?? a.party_id;
    (byParty[billTo] ??= []).push({
      id: a.id, label: `${a.material} — ${a.net_weight_kg}kg`,
      occurred_on: a.occurred_on, reference: a.reference, amount_minor: a.amount_minor, currency: a.currency,
    });
  }

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: org?.timezone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  return (
    <div className="space-y-6 p-8">
      <header>
        <Link href="/plastics/documents" className="text-[13px] text-ink-2 hover:text-ink">← Documents</Link>
        <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.01em] text-ink">Issue an invoice</h1>
      </header>
      <IssueForm parties={(parties ?? []) as PartyOption[]} activitiesByParty={byParty} locale={org?.locale ?? "en"} today={today} docKind="invoice" />
    </div>
  );
}
