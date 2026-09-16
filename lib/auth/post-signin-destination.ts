import type { createClient } from "@/lib/supabase/server";

/**
 * Where a signed-in user actually belongs — shared by the callback route
 * (right after exchanging a magic-link code) and /login (for someone already
 * signed in landing there again), so the two can never disagree.
 *
 *  - a profile already exists → `next` (or /dashboard)
 *  - no profile yet → /start, to create a new organisation
 *
 * Team invites (a second user joining an existing org) are a fast-follow —
 * see LogiFlow's accept_org_invite() for the pattern to port when needed.
 */
export async function postSignInDestination(
  supabase: Awaited<ReturnType<typeof createClient>>,
  next: string,
): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return next;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userData.user.id)
    .maybeSingle();

  return profile ? next : "/start";
}
