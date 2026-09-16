import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EmailSignIn } from "@/features/onboarding/components/EmailSignIn";
import { StartForm, type IndustryTemplate } from "@/features/onboarding/components/StartForm";

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
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center px-7">
          <Link href="/" className="font-semibold text-ink">Moonbook</Link>
        </div>
      </header>
      <div className="mx-auto max-w-[520px] px-7 py-14">
        {user ? (
          <StartForm templates={templates} />
        ) : (
          <EmailSignIn
            next="/start"
            heading="Let's get you set up."
            reason="Enter your email — we'll send a link, and you're straight into setup."
          />
        )}
      </div>
    </div>
  );
}
