import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !ANON || !SERVICE) {
  throw new Error(
    "e2e needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
}

/** Service role. For seeding and for asserting on rows a tenant cannot see. */
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
}

/**
 * A user-scoped client, signed in as `email`. RLS applies to it exactly as it
 * applies to the app, so a spec can assert "this tenant sees no rows" and mean
 * something by it.
 *
 * Signs in by minting a magic link and redeeming it directly rather than by
 * reading the inbox. The email route is a real thing to test and
 * `onboarding.spec.ts` does test it — but making forty other specs depend on
 * SMTP delivery buys nothing and loses reliability.
 */
export async function signIn(email: string) {
  const admin = adminClient();
  const { error: createErr } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (createErr) throw new Error(`createUser ${email}: ${createErr.message}`);

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr) throw new Error(`generateLink ${email}: ${linkErr.message}`);

  const client = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await client.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email",
  });
  if (error) throw new Error(`verifyOtp ${email}: ${error.message}`);
  await client.auth.setSession(data.session!);

  await waitUntilTokenAccepted(client, email);
  return { client, session: data.session! };
}

/**
 * Wait until PostgREST will accept the token the auth server has just minted.
 *
 * Both run in the same Docker VM and their clocks agree to the second, but the
 * JWT's `iat` is a whole-second value while acceptance is checked against a
 * sub-second clock — so a token issued at x.9s can briefly look like it was
 * issued in the future, and PostgREST answers "JWT issued at future".
 *
 * This is an environment artefact, not a product behaviour: a real browser
 * takes far longer than this to make its first request, so no user can hit it.
 * Rather than sleeping a fixed amount and hoping, poll a trivial authenticated
 * read until it succeeds, and fail loudly with the real error if it never does.
 */
async function waitUntilTokenAccepted(client: SupabaseClient, email: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const { error } = await client.from("industry_templates").select("key").limit(1);
    if (!error) return;
    last = error.message;
    // Anything other than the clock race is a real failure; surface it at once.
    if (!/issued at future|not yet valid|nbf|iat/i.test(last)) {
      throw new Error(`session for ${email} rejected: ${last}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`session for ${email} never became usable: ${last}`);
}

/**
 * The cookie @supabase/ssr reads back: `base64-` + base64 of the session JSON,
 * chunked once it passes the limit. Reconstructed here so a spec can start
 * already signed in, which is the difference between a suite that runs in two
 * minutes and one that walks an email flow forty times.
 *
 * The storage key is derived the way supabase-js derives it — the first label
 * of the auth host — so a local `http://127.0.0.1:56321` becomes
 * `sb-127-auth-token`.
 */
const MAX_CHUNK_SIZE = 3180;

export function authCookies(session: unknown, appUrl: string) {
  const name = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
  const value = "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64");
  const { hostname } = new URL(appUrl);

  const parts: { name: string; value: string }[] =
    value.length <= MAX_CHUNK_SIZE
      ? [{ name, value }]
      : Array.from({ length: Math.ceil(value.length / MAX_CHUNK_SIZE) }, (_, i) => ({
          name: `${name}.${i}`,
          value: value.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE),
        }));

  return parts.map((p) => ({
    ...p,
    domain: hostname,
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "Lax" as const,
  }));
}
