import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/auth/verify";
import { apiErr, apiOk } from "@/lib/api/response";
import { createGstnClient } from "@/lib/gstn/client";
import { GstnError } from "@/lib/gstn/types";

export const runtime = "nodejs";

/**
 * The real generate-IRN call, once one exists. Today `createGstnClient`
 * always throws `GstnError("not_configured")` — see its own file — so this
 * route always fails, clearly, with a 501 rather than pretending to work.
 * Left in place (not deleted) so the "Generate via GSTN" button in
 * ComplianceRefsForm has something real to call today, and so wiring the
 * actual provider adapter in later is a change to lib/gstn/client.ts alone,
 * not a new route.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const { id } = await params;
  const supabase = await createClient();

  const { data: connection, error: connectionErr } = await supabase
    .from("gstn_connections")
    .select("provider, environment, gstin")
    .eq("org_id", auth.ctx.orgId)
    .maybeSingle();

  // Surfaced rather than swallowed: a permission or query failure here must
  // never read as "no connection saved" — that's a different, misleading
  // message pointing the owner at the wrong fix.
  if (connectionErr) return apiErr("Could not load your GSTN connection", 500);
  if (!connection) {
    return apiErr("Connect a GSP in Settings before generating an IRN this way.", 422);
  }

  try {
    const client = createGstnClient({
      provider: connection.provider as never,
      environment: connection.environment as never,
      gstin: connection.gstin,
      credentials: {},
    });
    // Never reached today — createGstnClient always throws first.
    await client.generateIrn({
      documentId: id,
      invoiceNo: "", invoiceDate: "", totalMinor: 0, taxableValueMinor: 0,
      sellerGstin: connection.gstin, buyerGstin: "", lines: [],
    });
    return apiOk({ generated: true });
  } catch (err) {
    if (err instanceof GstnError) {
      return apiErr(err.message, 501);
    }
    throw err;
  }
}
