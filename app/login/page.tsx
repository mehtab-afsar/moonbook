import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { postSignInDestination } from "@/lib/auth/post-signin-destination";
import { EmailSignIn } from "@/features/onboarding/components/EmailSignIn";

export const metadata = { title: "Sign in", robots: { index: false } };

export default async function LoginPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) redirect(await postSignInDestination(supabase, "/dashboard"));

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center px-7">
          <Link href="/" className="font-semibold text-ink">Moonbook</Link>
        </div>
      </header>
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
