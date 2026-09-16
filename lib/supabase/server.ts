import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/supabase";
import { env } from "@/lib/env";

/**
 * User-scoped server client. This is the default for every route handler and
 * server component: RLS is the tenancy boundary, so reading through this
 * client is what makes cross-org access impossible.
 *
 * Reach for lib/supabase/admin.ts only where the service role is genuinely
 * required, and only after the caller has already been authorised.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, which cannot set cookies.
          // Safe to ignore: proxy.ts refreshes the session on every request.
        }
      },
    },
  });
}
