import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { apiErr } from "@/lib/api/response";
import { DocumentPdf } from "@/lib/pdf/DocumentPdf";
import { parseSnapshot } from "@/lib/pdf/snapshot";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Renders a document from its frozen snapshot alone.
 *
 * Nothing here joins a live table — not the organisation, not the party, not
 * the field definitions. That is the point: the PDF served today is byte-for-
 * byte what was served the day it was issued, no matter how much the business
 * has reconfigured itself since. It also means a draft has no PDF, because a
 * draft has no snapshot, which is the correct answer rather than a limitation.
 *
 * Tenancy is RLS: the select carries no org filter, so a document belonging to
 * another organisation returns no row and is reported as 404 — never 403,
 * which would confirm it exists.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const { id } = await params;
  const supabase = await createClient();

  const { data: doc, error } = await supabase
    .from("documents")
    .select("id, doc_no, party_doc_no, doc_kind, status, issued_snapshot")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    log.error("GET /api/documents/[id]/pdf: query failed", { err: error.message, id });
    return apiErr("Could not load this document", 500);
  }
  if (!doc) return apiErr("Document not found", 404);

  if (doc.status === "draft" || !doc.issued_snapshot) {
    return apiErr("This document has not been issued yet, so there is nothing to print", 409);
  }

  let buffer: Buffer;
  try {
    const snapshot = parseSnapshot(doc.issued_snapshot);
    buffer = await renderToBuffer(<DocumentPdf snapshot={snapshot} />);
  } catch (err) {
    log.error("GET /api/documents/[id]/pdf: render failed", {
      err: err instanceof Error ? err.message : String(err),
      id,
    });
    return apiErr("Could not render this document", 500);
  }

  const filename = `${doc.doc_kind}-${doc.doc_no ?? doc.party_doc_no ?? doc.id}.pdf`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      // An issued document is immutable, so it is safe to cache hard — but
      // privately: it names a customer and an amount, and must never sit in
      // a shared proxy.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
