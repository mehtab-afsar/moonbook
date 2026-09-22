import "server-only";
import type { GstnClient, GstnClientConfig } from "@/lib/gstn/types";
import { GstnError } from "@/lib/gstn/types";

/**
 * The one place the rest of the app asks for a GSTN client. Today it always
 * throws — there is no GSP account, so there is nothing to configure it
 * with. This function is the seam: once real credentials exist (see
 * gstn_connections' own comment on why they will never live in a database
 * column), a real provider adapter gets built under lib/gstn/providers/ and
 * wired in HERE, and every caller (the "Generate via GSTN" button, a future
 * background job) keeps working unchanged.
 *
 * TODO(gstn-integration): once a GSP is under contract and sandbox
 * credentials exist —
 *   1. Add lib/gstn/providers/<provider>.ts implementing GstnClient for
 *      that GSP's actual REST API (auth flow, request/response shapes).
 *   2. Read that provider's credentials from environment variables (or a
 *      real secrets manager) — never from `gstn_connections`, which holds
 *      no secrets on purpose.
 *   3. Replace the `throw` below with a switch on `config.provider` that
 *      constructs and returns the matching adapter.
 */
export function createGstnClient(config: GstnClientConfig): GstnClient {
  void config;
  throw new GstnError(
    "GSTN integration is not wired up yet — this organisation's connection is recorded but no GSP credentials exist in this codebase. See lib/gstn/client.ts.",
    "not_configured",
  );
}
