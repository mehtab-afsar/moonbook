import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "staff";

export interface AuthContext {
  userId: string;
  orgId: string;
  role: Role;
  fullName: string | null;
}

export type VerifyResult =
  | { ok: true; ctx: AuthContext }
  | { ok: false; error: string; status: 401 | 403 };

/**
 * Centralised staff authentication for route handlers and server components.
 *
 * Returns a discriminated union rather than throwing, so every route reads
 * the same way:
 *
 *   const auth = await verifyAuth()
 *   if (!auth.ok) return apiErr(auth.error, auth.status)
 *
 * Uses getUser(), never getSession(): getSession trusts the cookie without
 * revalidating it against the auth server.
 *
 * This returns the caller's org and role for convenience only — it is not
 * the security boundary. RLS is. Route handlers must still read through
 * lib/supabase/server.ts so the database enforces tenancy independently.
 */
export async function verifyAuth(): Promise<VerifyResult> {
  const supabase = await createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { ok: false, error: "Not signed in", status: 401 };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, org_id, role, full_name")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile) {
    return { ok: false, error: "No profile for this account", status: 403 };
  }

  return {
    ok: true,
    ctx: {
      userId: profile.id,
      orgId: profile.org_id,
      role: profile.role as Role,
      fullName: profile.full_name,
    },
  };
}

/** Same, but also requires the owner role — issuing, cancelling, exporting
 *  and closing a period are all owner-only actions. */
export async function requireOwner(): Promise<VerifyResult> {
  const auth = await verifyAuth();
  if (!auth.ok) return auth;
  if (auth.ctx.role !== "owner") {
    return { ok: false, error: "This action requires the owner role", status: 403 };
  }
  return auth;
}
