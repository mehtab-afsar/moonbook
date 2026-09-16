import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Refreshes the Supabase session cookie and guards the authenticated area.
 *
 * Ported from LedgerFlow unchanged: PUBLIC_PATHS short-circuits before any
 * Supabase call, getUser() (never getSession()) revalidates against the auth
 * server, and a timeout is never treated as "signed out."
 */
const PUBLIC_PATHS = new Set(["/", "/start", "/login", "/auth/callback"]);

const PUBLIC_PREFIXES = [
  "/_next/", "/favicon", "/icon", "/apple-icon", "/apple-touch-icon",
  "/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/manifest.json",
];

const TIMED_OUT = Symbol("timed-out");

async function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<typeof TIMED_OUT>((resolve) => setTimeout(() => resolve(TIMED_OUT), ms)),
  ]);
}

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  let response = NextResponse.next({ request: { headers: request.headers } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: request.headers } });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const result = await withTimeout(supabase.auth.getUser(), 5_000);
  if (result === TIMED_OUT) return response;

  const user = result.data.user;

  // API routes do their own authorisation and must get JSON, never a redirect.
  if (pathname.startsWith("/api/")) return response;

  if (!user) {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};
