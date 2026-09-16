import { execFileSync } from "node:child_process";

/**
 * Run SQL as an operator would.
 *
 * `industry_templates` is shared between every business on Moonbook, so no
 * client role has a write grant on it — not even the service role. That is
 * deliberate: a tenant must not be able to reshape what every other business
 * is offered at signup, and the service key is one leaked environment variable
 * away from being a tenant.
 *
 * Adding an industry is therefore an operator action — psql or Studio — and
 * this runs it that way rather than weakening the grant to make a test easier.
 * The claim being defended is "no application code, no schema change, no
 * redeploy", and that claim survives this intact.
 */
export function psql(sql: string): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error("e2e needs SUPABASE_DB_URL in .env.local to act as an operator");
  }
  return execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", sql], {
    encoding: "utf8",
  }).trim();
}

/** SQL string literal quoting, for the few places a value is interpolated. */
export function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
