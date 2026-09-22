import type { createClient } from "@/lib/supabase/server";

/**
 * Where a signed-in user actually belongs — shared by the callback route
 * (right after exchanging a magic-link code) and /login (for someone already
 * signed in landing there again), so the two can never disagree.
 *
 *  - a profile already exists → `next` (or /dashboard)
 *  - no profile yet, but an invite is waiting for this email → accept it and
 *    join that org (see accept_org_invite())
 *  - no profile and no invite → /start, to create a new organisation
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

  let vertical = profile?.organisations?.vertical;

  if (!profile) {
    // A no-op, not an error, when there's nothing to accept — safe to call
    // unconditionally rather than checking for a pending invite first.
    const { data: accepted } = await supabase.rpc("accept_org_invite").maybeSingle();
    if (!accepted?.org_id) return "/start";

    const { data: org } = await supabase
      .from("organisations")
      .select("vertical")
      .eq("id", accepted.org_id)
      .single();
    vertical = org?.vertical;
  }

  // A forked-vertical org's data lives entirely outside the shared tables,
  // so the default `next` (almost always /dashboard) would land it on a
  // page that can never show anything true for it. Only the default is
  // redirected — an explicit `next` (e.g. a deep link from /start) is
  // still honoured as asked.
  if (next === "/dashboard" && (vertical === "logistics" || vertical === "plastics")) {
    return `/${vertical}/dashboard`;
  }
  return next;
}
