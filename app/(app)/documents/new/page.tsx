import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import {
  IssueForm,
  type BillableActivity,
  type PartyOption,
} from "@/features/documents/components/IssueForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Issue an invoice" };

/** The activity as it comes back, with its type's label and its own details. */
type Row = {
  id: string;
  occurred_on: string;
  reference: string | null;
  amount_minor: number;
  currency: string;
  party_id: string;
  bill_to_party_id: string | null;
  details: Record<string, string> | null;
  activity_types: { label_singular: string } | null;
};

export default async function NewDocumentPage() {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");
  // Issuing is an owner action — the same rule the RPC enforces, applied here
  // so a member of staff is told rather than shown a form that will refuse.
  if (auth.ctx.role !== "owner") redirect("/documents");

  const supabase = await createClient();
  const [{ data: org }, { data: parties }, { data: activities, error }, { data: fields }] =
    await Promise.all([
      supabase.from("organisations").select("locale, timezone").eq("id", auth.ctx.orgId).single(),
      supabase.from("parties").select("id, name, payment_terms_days").order("name"),
      supabase
        .from("activities")
        // Named FKs on both embeds: activities reaches activity_types by three
        // keys and parties by two. See CONVENTIONS.md section 11.
        .select(
          "id, occurred_on, reference, amount_minor, currency, party_id, bill_to_party_id, details, activity_types!activities_activity_type_id_fkey(label_singular)",
        )
        .eq("status", "completed")
        .eq("direction", "receivable")
        .order("occurred_on", { ascending: false }),
      supabase
        .from("activity_fields")
        .select("key, label, show_on_document, sort_order")
        .not("org_id", "is", null)
        .eq("show_on_document", true)
        .order("sort_order"),
    ]);

  if (error) throw new Error(`Could not load billable work: ${error.message}`);

  // A one-line summary of each activity, built from whatever fields that
  // business configured. The page has no idea what a "route" or a "grade" is;
  // it prints the labels it was given, in the order they were given.
  const labelByKey = new Map((fields ?? []).map((f) => [f.key as string, f.label as string]));
  const summarise = (details: Record<string, string> | null): string | null => {
    if (!details) return null;
    const parts = (fields ?? [])
      .map((f) => {
        const value = details[f.key as string];
        return value ? `${labelByKey.get(f.key as string)}: ${value}` : null;
      })
      .filter((p): p is string => p !== null);
    return parts.length > 0 ? parts.join(" · ") : null;
  };

  const byParty: Record<string, BillableActivity[]> = {};
  for (const raw of (activities ?? []) as unknown as Row[]) {
    // Billed to whoever pays, which is not always who the work was done for.
    const billTo = raw.bill_to_party_id ?? raw.party_id;
    (byParty[billTo] ??= []).push({
      id: raw.id,
      label: raw.activity_types?.label_singular ?? "Item",
      occurred_on: raw.occurred_on,
      reference: raw.reference,
      amount_minor: raw.amount_minor,
      currency: raw.currency,
      detail: summarise(raw.details),
    });
  }

  // Today where the business is, not where the server is.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: org?.timezone ?? "UTC",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  return (
    <div className="space-y-6 p-8">
      <header>
        <Link href="/documents" className="text-[13px] text-ink-2 hover:text-ink">
          ← Documents
        </Link>
        <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.01em] text-ink">
          Issue an invoice
        </h1>
        <p className="mt-1 text-[13.5px] text-ink-2">
          Pick the completed work to bill. Once issued, the invoice is frozen exactly as it
          reads — later changes to your settings never rewrite it.
        </p>
      </header>

      <IssueForm
        parties={(parties ?? []) as PartyOption[]}
        activitiesByParty={byParty}
        locale={org?.locale ?? "en"}
        today={today}
      />
    </div>
  );
}
