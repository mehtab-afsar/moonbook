import { redirect } from "next/navigation";
import { verifyAuth } from "@/lib/auth/verify";
import { createClient } from "@/lib/supabase/server";
import { LogisticsSidebar } from "@/features/logistics/components/LogisticsSidebar";

export default async function LogisticsLayout({ children }: { children: React.ReactNode }) {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");
  // Any other vertical has no rows in logistics_* — send it back to its own
  // ledger rather than showing it an empty one.
  if (auth.ctx.vertical !== "logistics") {
    redirect(auth.ctx.vertical === "shared" ? "/dashboard" : `/${auth.ctx.vertical}/dashboard`);
  }

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organisations")
    .select("legal_name")
    .eq("id", auth.ctx.orgId)
    .single();

  return (
    <div className="flex min-h-dvh bg-paper">
      <LogisticsSidebar orgName={org?.legal_name ?? "Moonbook"} userName={auth.ctx.fullName ?? auth.ctx.role} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
