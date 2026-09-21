import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EmailSignIn } from "@/features/onboarding/components/EmailSignIn";
import { StartForm, type IndustryTemplate } from "@/features/onboarding/components/StartForm";
import { SiteHeader } from "@/features/marketing/components/SiteHeader";

export const metadata = { title: "Get started" };

export default async function StartPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
    if (profile) redirect("/dashboard");
  }

  // The industries on offer are rows, not a hardcoded list — adding one is a
  // seed INSERT and this page picks it up with no change.
  let templates: IndustryTemplate[] = [];
  if (user) {
    const { data, error } = await supabase
      .from("industry_templates")
      .select("key, label, description")
      .order("sort_order");
    if (error) throw new Error(`Could not load industry templates: ${error.message}`);
    templates = data ?? [];
  }

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <SiteHeader />
      <div className="mx-auto max-w-[560px] px-7 py-14">
        {user ? (
          <StartForm templates={templates} />
        ) : (
          <EmailSignIn
            next="/start"
            heading="Let's get you set up."
            reason="Enter your email — we'll send a link, and you're straight into setup."
            step={{ current: 1, total: 2 }}
          />
        )}
      </div>
    </div>
  );
}
