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

  // FK named: profiles reaches organisations by org_id, and an ambiguous
  // embed is a PostgREST error rather than a guess.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, organisations!profiles_org_id_fkey(vertical)")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!profile) return "/start";

  // A forked-vertical org's data lives entirely outside the shared tables,
  // so the default `next` (almost always /dashboard) would land it on a
  // page that can never show anything true for it. Only the default is
  // redirected — an explicit `next` (e.g. a deep link from /start) is
  // still honoured as asked.
  const vertical = profile.organisations?.vertical;
  if (next === "/dashboard" && (vertical === "logistics" || vertical === "plastics")) {
    return `/${vertical}/dashboard`;
  }
  return next;
}
