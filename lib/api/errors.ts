import type { PostgrestError } from "@supabase/supabase-js";
import { apiErr } from "@/lib/api/response";
import { log } from "@/lib/logger";

/**
 * One SQLSTATE → HTTP map for every route.
 *
 * LedgerFlow handles four of its eight codes, inline, per route — so `28000`
 * (no organisation), `22003` (amount out of range), `22023` (bad argument) and
 * `22004` (missing required argument) all surface to the user as an opaque
 * 500 that says "something went wrong". The RPCs already raise precise codes;
 * throwing that precision away at the boundary is the waste.
 */
const STATUS_BY_SQLSTATE: Readonly<Record<string, number>> = {
  "28000": 401, // invalid_authorization_specification — no user, or no org
  "42501": 403, // insufficient_privilege — role gate failed
  P0002: 404, //   no_data_found — missing, wrong org, or wrong state
  "23505": 409, // unique_violation — already exists / already done
  "23514": 409, // check_violation — business rule violated
  "23503": 409, // foreign_key_violation — references something that isn't there
  "22003": 422, // numeric_value_out_of_range — amount/allocation out of bounds
  "22023": 422, // invalid_parameter_value — unknown enum-ish argument
  "22004": 422, // null_value_not_allowed — required argument missing
};

/** 500s are logged; everything else is a fact about the request, not a fault. */
export function statusForSqlState(code: string | undefined): number {
  return (code && STATUS_BY_SQLSTATE[code]) || 500;
}

/**
 * Turn a PostgrestError into a response.
 *
 * The RPCs raise messages written for a person ("allocate: 90000 exceeds the
 * 68000 still owed on this document"), prefixed with the function name. The
 * prefix is stripped for display — it is useful in a log, not on a screen.
 */
export function rpcError(where: string, error: PostgrestError, fallback: string) {
  const status = statusForSqlState(error.code);
  if (status === 500) {
    log.error(where, { err: error.message, code: error.code });
    return apiErr(fallback, 500);
  }
  return apiErr(stripFunctionPrefix(error.message) || fallback, status);
}

function stripFunctionPrefix(message: string): string {
  const m = /^[a-z_]+:\s*([\s\S]+)$/i.exec(message.trim());
  const text = (m ? m[1] : message).trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
