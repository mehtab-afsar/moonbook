import { createDocumentPdfHandler } from "@/lib/pdf/documentPdfHandler";

/**
 * The shared ledger's documents: rendered from their own frozen
 * `issued_snapshot`, byte-for-byte what was served the day they were
 * issued — see lib/pdf/documentPdfHandler.tsx for what "frozen" means and
 * lib/pdf/snapshot.ts for why that immutability matters. Tenancy is RLS:
 * the underlying select carries no org filter, so a document belonging to
 * another organisation returns no row and is reported as 404, never 403,
 * which would confirm it exists.
 */
export const runtime = "nodejs";

export const GET = createDocumentPdfHandler({
  mode: "frozen",
  vertical: null,
  documentsTable: "documents",
  balancesTable: "document_balances",
  complianceRefs: true,
});
