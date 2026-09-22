import { createDocumentPdfHandler } from "@/lib/pdf/documentPdfHandler";
import { buildLogisticsSnapshot } from "@/lib/logistics/pdf-snapshot";

/**
 * Renders live, not from a frozen snapshot — see buildLogisticsSnapshot's
 * own comment for the gap that leaves.
 */
export const runtime = "nodejs";

export const GET = createDocumentPdfHandler({
  mode: "live",
  vertical: "logistics",
  documentsTable: "logistics_documents",
  linesTable: "logistics_document_lines",
  taxesTable: "logistics_document_taxes",
  balancesTable: "logistics_document_balances",
  counterpartyFk: "logistics_documents_counterparty_org_fk",
  buildSnapshot: buildLogisticsSnapshot,
});
