import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { env } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Use only where the service role is genuinely required (signed storage URLs
 * for invoice PDFs/proof attachments, the PDF cache, seed scripts) and only
 * after the caller has already been authorised. Everything else uses
 * lib/supabase/server.ts so RLS stays the tenancy boundary.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
