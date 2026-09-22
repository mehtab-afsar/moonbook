import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import type { ExpenseRow } from "@/features/expenses/components/ExpensesPanel";
import { ExpensesPageClient } from "@/features/expenses/components/ExpensesPageClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Expenses" };

export default async function ExpensesPage() {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");

  const supabase = await createClient();
  const [{ data: org }, { data: parties }, { data: expenses, error }] = await Promise.all([
    supabase.from("organisations").select("locale, timezone, base_currency").eq("id", auth.ctx.orgId).single(),
    supabase.from("parties").select("id, name").order("name"),
    supabase
      .from("expenses")
      .select("id, category, description, currency, amount_minor, incurred_on, party_id, parties(name)")
      .order("incurred_on", { ascending: false })
      .limit(200),
  ]);

  if (error) throw new Error(`Could not load expenses: ${error.message}`);

  const locale = org?.locale ?? "en";
  const currency = org?.base_currency ?? "INR";
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: org?.timezone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  const rows: ExpenseRow[] = (expenses ?? []).map((e) => {
    const party = (e as unknown as { parties: { name: string } | null }).parties;
    return {
      id: e.id, category: e.category, description: e.description, currency: e.currency,
      amount_minor: e.amount_minor, incurred_on: e.incurred_on, party_name: party?.name ?? null,
    };
  });

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-8">
      <ExpensesPageClient parties={parties ?? []} expenses={rows} currency={currency} locale={locale} today={today} />
    </div>
  );
}
