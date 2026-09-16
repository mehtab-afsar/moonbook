import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { postSignInDestination } from "@/lib/auth/post-signin-destination";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  // Only ever redirect to a path on this origin, never to an absolute URL a
  // caller supplied — that would be an open redirect.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${await postSignInDestination(supabase, safeNext)}`);
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
