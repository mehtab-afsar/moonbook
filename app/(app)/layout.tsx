import { redirect } from "next/navigation";
import { verifyAuth } from "@/lib/auth/verify";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/features/shell/components/Sidebar";
import { LogisticsSidebar } from "@/features/logistics/components/LogisticsSidebar";
import { PlasticsSidebar } from "@/features/plastics/components/PlasticsSidebar";

/**
 * The single layout wrapping every page under (app) — including /parties and
 * /settings, which are shared routes reachable from all three verticals (see
 * the fork's own stated boundary: tenancy/identity primitives stay shared,
 * billing logic forks). It has to pick the SAME nav rail a vertical's own
 * pages show, or navigating to Parties/Settings swaps the whole sidebar out
 * from under the user — wrong items, missing items, and back again on the
 * next click.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organisations")
    .select("legal_name")
    .eq("id", auth.ctx.orgId)
    .single();

  const orgName = org?.legal_name ?? "Moonbook";
  const userName = auth.ctx.fullName ?? auth.ctx.role;

  const sidebar =
    auth.ctx.vertical === "logistics" ? (
      <LogisticsSidebar orgName={orgName} userName={userName} />
    ) : auth.ctx.vertical === "plastics" ? (
      <PlasticsSidebar orgName={orgName} userName={userName} />
    ) : (
      <Sidebar orgName={orgName} userName={userName} />
    );

  return (
    <div className="flex h-dvh bg-paper">
      {sidebar}
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
