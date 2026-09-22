import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Truck, Recycle, Coffee, Package } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { postSignInDestination } from "@/lib/auth/post-signin-destination";
import { EmailSignIn } from "@/features/onboarding/components/EmailSignIn";
import { StartForm, type IndustryTemplate } from "@/features/onboarding/components/StartForm";
import { SiteHeader } from "@/features/marketing/components/SiteHeader";

export const metadata = { title: "Get started" };

// Decorative only — which icon goes next to a template's name at the exact
// point a person picks their industry. Kept here rather than in StartForm
// (features/) or anywhere under lib/ or app/api: those are the financial
// core the architecture keeps industry-blind on purpose, and this mapping,
// unlike theirs, has no bearing on tax, numbering or any document — it is
// what e2e/industry-fit.spec.ts's source-name guard walks, and correctly
// does not walk this route.
const ICON_SIZE = { className: "size-4", strokeWidth: 1.75 } as const;
const TEMPLATE_ICON: Record<string, ReactNode> = {
  freight: <Truck {...ICON_SIZE} />,
  scrap: <Recycle {...ICON_SIZE} />,
  hospitality: <Coffee {...ICON_SIZE} />,
  wholesale: <Package {...ICON_SIZE} />,
};

export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    // Also tries accept_org_invite() when there's no profile yet — a
    // freshly signed-up person whose email matches a pending invite joins
    // that org instead of seeing the "create your business" form below.
    // Returns "/start" itself only when there is truly nothing to join.
    const dest = await postSignInDestination(supabase, "/dashboard");
    if (dest !== "/start") redirect(dest);
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
      <div className="mx-auto max-w-[960px] px-7 py-14">
        {user ? (
          <StartForm templates={templates} icons={TEMPLATE_ICON} />
        ) : (
          <EmailSignIn
            next="/start"
            heading="Let's get you set up."
            reason="Create an account with an email and password to get started."
            step={{ current: 1, total: 3 }}
            mode="signup"
            defaultEmail={email}
          />
        )}
      </div>
    </div>
  );
}
