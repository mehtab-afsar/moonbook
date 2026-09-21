import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { formatMoney } from "@/lib/money";
import { ExpenseForm } from "@/features/expenses/components/ExpenseForm";

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
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: org?.timezone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  const total = (expenses ?? []).reduce((sum, e) => sum + e.amount_minor, 0);

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Expenses</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">
          Overhead, not tied to any one job — rent, salaries, subscriptions. What a
          specific piece of work cost to deliver is recorded on the activity itself instead.
        </p>
      </header>

      <ExpenseForm parties={parties ?? []} currency={org?.base_currency ?? "INR"} today={today} />

      <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-line-soft text-[12px] uppercase tracking-wide text-ink-3">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Category</th>
              <th className="px-5 py-3 font-medium">Description</th>
              <th className="px-5 py-3 font-medium">Party</th>
              <th className="px-5 py-3 font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(expenses ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-ink-3">
                  Nothing logged yet.
                </td>
              </tr>
            )}
            {(expenses ?? []).map((e) => {
              const party = (e as unknown as { parties: { name: string } | null }).parties;
              return (
                <tr key={e.id} className="border-b border-line-soft last:border-b-0">
                  <td className="px-5 py-3 font-mono text-ink-2">{e.incurred_on}</td>
                  <td className="px-5 py-3 font-medium text-ink">{e.category}</td>
                  <td className="px-5 py-3 text-ink-2">{e.description ?? "—"}</td>
                  <td className="px-5 py-3 text-ink-2">{party?.name ?? "—"}</td>
                  <td className="px-5 py-3 font-mono text-ink">
                    {formatMoney(e.amount_minor, e.currency, locale)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {(expenses ?? []).length > 0 && (
            <tfoot>
              <tr className="border-t border-line font-medium">
                <td colSpan={4} className="px-5 py-3 text-right text-ink-2">Total</td>
                <td className="px-5 py-3 font-mono text-ink">
                  {formatMoney(total, org?.base_currency ?? "INR", locale)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
