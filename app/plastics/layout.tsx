import { redirect } from "next/navigation";
import { verifyAuth } from "@/lib/auth/verify";
import { createClient } from "@/lib/supabase/server";
import { PlasticsSidebar } from "@/features/plastics/components/PlasticsSidebar";

export default async function PlasticsLayout({ children }: { children: React.ReactNode }) {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");
  if (auth.ctx.vertical !== "plastics") {
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
      <PlasticsSidebar orgName={org?.legal_name ?? "Moonbook"} userName={auth.ctx.fullName ?? auth.ctx.role} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
