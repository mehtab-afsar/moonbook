/**
 * Single source of truth for environment configuration.
 *
 * Lazy getters, so a missing optional key never breaks an unrelated import
 * path. Nothing outside this file may read process.env for these values.
 */

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${key}. ` +
        `Check your .env.local (see .env.example), or run \`npx supabase status\` for local values.`,
    );
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const env = {
  get supabaseUrl() {
    return requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceKey() {
    return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  },
  get appUrl() {
    return optionalEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
} as const;

const CRITICAL = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export function validateRequiredEnv(): void {
  const missing = CRITICAL.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Cannot start: missing required environment variables: ${missing.join(", ")}. See .env.example.`,
    );
  }
}
