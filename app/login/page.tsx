import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { postSignInDestination } from "@/lib/auth/post-signin-destination";
import { EmailSignIn } from "@/features/onboarding/components/EmailSignIn";
import { SiteHeader } from "@/features/marketing/components/SiteHeader";

export const metadata = { title: "Sign in", robots: { index: false } };

export default async function LoginPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect(await postSignInDestination(supabase, "/dashboard"));

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <SiteHeader />
      <div className="mx-auto max-w-[420px] px-7 py-16">
        <EmailSignIn
          next="/dashboard"
          heading="Sign in."
          reason="Enter the email your account is registered with and we'll send you a link."
        />
        <p className="mt-8 text-[13px] text-ink-3">
          New here?{" "}
          <Link href="/start" className="font-medium text-brand hover:text-brand-hover">
            Set up your business
          </Link>
        </p>
      </div>
    </div>
  );
}
