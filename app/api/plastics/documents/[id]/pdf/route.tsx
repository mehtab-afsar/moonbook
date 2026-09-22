import { createDocumentPdfHandler } from "@/lib/pdf/documentPdfHandler";
import { buildPlasticsSnapshot } from "@/lib/plastics/pdf-snapshot";

/**
 * Renders live, not from a frozen snapshot — see buildPlasticsSnapshot's own
 * comment for the gap that leaves.
 */
export const runtime = "nodejs";

export const GET = createDocumentPdfHandler({
  mode: "live",
  vertical: "plastics",
  documentsTable: "plastics_documents",
  linesTable: "plastics_document_lines",
  taxesTable: "plastics_document_taxes",
  balancesTable: "plastics_document_balances",
  counterpartyFk: "plastics_documents_counterparty_org_fk",
  buildSnapshot: buildPlasticsSnapshot,
});
