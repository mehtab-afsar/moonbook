import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth, type Vertical } from "@/lib/auth/verify";
import { apiErr } from "@/lib/api/response";
import { DocumentPdf } from "@/lib/pdf/DocumentPdf";
import { parseSnapshot, type DocumentSnapshot } from "@/lib/pdf/snapshot";
import { loadOrgLogoDataUri } from "@/lib/pdf/logo";
import { log } from "@/lib/logger";

type ApiError = ReturnType<typeof apiErr>;

/**
 * supabase-js's generated types only know the table names baked in at
 * codegen time — a config-driven table name defeats that by design. Each
 * call site below narrows the untyped result immediately with its own row
 * interface (LiveDocumentRow etc.), so this loses column-name checking at
 * the query itself but not at the point the data is actually used.
 */
function dynTable(supabase: Supabase, name: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
  return (supabase.from as any)(name);
}

/**
 * ONE handler behind every "download this invoice" button in the product,
 * whatever industry issued it. A vertical's fork gets its own documents
 * table (its own columns for the facts particular to that trade), but
 * printing one was never actually industry-specific — it is always: load
 * the document, load the organisation's template choice and logo, build a
 * `DocumentSnapshot`, hand it to `DocumentPdf`. Three copies of that logic
 * (shared/logistics/plastics) is how a fourth vertical's PDF route silently
 * ships without the newest field, or with a stale copy of a bug already
 * fixed twice elsewhere. This file is the fix: a vertical's route becomes
 * one call naming its tables, not another ninety lines.
 *
 * Two `mode`s cover the two shapes a vertical's documents ever take:
 *
 *   "frozen" — the document carries its own `issued_snapshot` (jsonb), never
 *              rewritten after issue. The shared ledger's real design; see
 *              lib/pdf/snapshot.ts for why that immutability matters. A new
 *              vertical should use this from day one if it can.
 *
 *   "live"   — no snapshot column exists yet (or exists but nothing writes
 *              it — see lib/logistics/pdf-snapshot.ts and
 *              lib/plastics/pdf-snapshot.ts for the two verticals currently
 *              taking this shortcut, and the cost it carries: change this
 *              organisation's tax settings, and an old document's PDF
 *              changes with it). `buildSnapshot` assembles the shape
 *              `DocumentPdf` expects from the live rows this config names.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

interface LivePartyRow {
  name: string;
  tax_id: string | null;
  tax_id_kind: string | null;
  address: string | null;
  region_code: string | null;
}

interface LiveDocumentRow {
  id: string;
  direction: string;
  doc_kind: string;
  doc_no: string | null;
  party_doc_no: string | null;
  doc_date: string;
  due_date: string | null;
  status: string;
  currency: string;
  taxable_value_minor: number;
  total_minor: number;
  tax_treatment: string;
  notes: string | null;
  counterparty_id: string;
}

interface LiveLineRow {
  description: string;
  amount_minor: number;
}

interface LiveTaxRow {
  component_code: string;
  component_label: string;
  rate_pct: number;
  amount_minor: number;
}

interface OrgRow {
  legal_name: string; tax_id: string | null; tax_id_kind: string | null;
  region_code: string | null; address: string | null; locale: string; base_currency: string;
  logo_path: string | null; invoice_template: string | null;
  invoice_show_hsn: boolean; invoice_terms: string | null;
}

export type DocumentPdfHandlerConfig =
  | {
      mode: "frozen";
      /** `null` serves every vertical whose documents live in the shared
       *  `documents` table — that table already carries every vertical's
       *  frozen documents today, so there is nothing to gate on. */
      vertical: null;
      documentsTable: string;
      balancesTable: string;
      /** Reads compliance refs (e-way bill / IRN) alongside the snapshot —
       *  only the shared `documents` table carries these columns today. */
      complianceRefs?: boolean;
    }
  | {
      mode: "live";
      vertical: Vertical;
      documentsTable: string;
      linesTable: string;
      taxesTable: string;
      balancesTable: string;
      /** The FK constraint name PostgREST needs to embed the counterparty's
       *  party row, e.g. "logistics_documents_counterparty_org_fk". */
      counterpartyFk: string;
      buildSnapshot: (input: {
        document: LiveDocumentRow;
        lines: LiveLineRow[];
        taxes: LiveTaxRow[];
        counterparty: LivePartyRow;
        organisation: OrgRow;
      }) => DocumentSnapshot;
    };

const ORG_COLUMNS =
  "legal_name, tax_id, tax_id_kind, region_code, address, locale, base_currency, logo_path, invoice_template, invoice_show_hsn, invoice_terms";

interface RenderInputs {
  snapshot: DocumentSnapshot;
  logoPath: string | null;
  balance: { settledMinor: number; balanceDueMinor: number } | null;
  templateKey: string | null;
  invoiceOptions: { showHsn: boolean; terms: string | null } | null;
  compliance?: { ewbNo: string | null; irn: string | null; irnAckNo: string | null } | null;
  docKind: string;
  docNo: string | null;
  partyDocNo: string | null;
  docId: string;
}

export function createDocumentPdfHandler(config: DocumentPdfHandlerConfig) {
  return async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await verifyAuth();
    if (!auth.ok) return apiErr(auth.error, auth.status);
    if (config.vertical && auth.ctx.vertical !== config.vertical) {
      return apiErr("Not available for this organisation", 403);
    }

    const { id } = await params;
    const supabase = await createClient();
    const routeLabel = `GET .../${config.documentsTable}/[id]/pdf`;

    const loaded =
      config.mode === "frozen"
        ? await loadFrozen(supabase, id, auth.ctx.orgId, config, routeLabel)
        : await loadLive(supabase, id, auth.ctx.orgId, config, routeLabel);
    if (loaded.error) return loaded.error;
    const inputs = loaded.inputs;

    let buffer: Buffer;
    try {
      const logoDataUri = await loadOrgLogoDataUri(supabase, inputs.logoPath);
      buffer = await renderToBuffer(
        <DocumentPdf
          snapshot={inputs.snapshot}
          logoDataUri={logoDataUri}
          balance={inputs.balance}
          invoiceOptions={inputs.invoiceOptions}
          compliance={inputs.compliance}
          templateKey={inputs.templateKey}
        />,
      );
    } catch (err) {
      log.error(`${routeLabel}: render failed`, { err: err instanceof Error ? err.message : String(err), id });
      return apiErr("Could not render this document", 500);
    }

    const filename = `${inputs.docKind}-${(inputs.docNo ?? inputs.partyDocNo ?? inputs.docId).replace(/[/\\]/g, "-")}.pdf`;
    const download = new URL(req.url).searchParams.get("download") === "1";

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  };
}

async function loadFrozen(
  supabase: Supabase,
  id: string,
  orgId: string,
  config: Extract<DocumentPdfHandlerConfig, { mode: "frozen" }>,
  routeLabel: string,
): Promise<{ error: ApiError } | { error: null; inputs: RenderInputs }> {
  const columns = config.complianceRefs
    ? "id, doc_no, party_doc_no, doc_kind, status, issued_snapshot, ewb_no, irn, irn_ack_no"
    : "id, doc_no, party_doc_no, doc_kind, status, issued_snapshot";

  const { data: doc, error } = await dynTable(supabase, config.documentsTable).select(columns).eq("id", id).maybeSingle();
  if (error) {
    log.error(`${routeLabel}: query failed`, { err: error.message, id });
    return { error: apiErr("Could not load this document", 500) };
  }
  const row = doc as unknown as {
    id: string; doc_no: string | null; party_doc_no: string | null; doc_kind: string;
    status: string; issued_snapshot: unknown;
    ewb_no?: string | null; irn?: string | null; irn_ack_no?: string | null;
  } | null;
  if (!row) return { error: apiErr("Document not found", 404) };
  if (row.status === "draft" || !row.issued_snapshot) {
    return { error: apiErr("This document has not been issued yet, so there is nothing to print", 409) };
  }

  const [{ data: org }, { data: balanceRow }] = await Promise.all([
    supabase.from("organisations").select(ORG_COLUMNS).eq("id", orgId).single(),
    dynTable(supabase, config.balancesTable).select("settled_minor, balance_due_minor").eq("document_id", id).maybeSingle(),
  ]);

  let snapshot: DocumentSnapshot;
  try {
    snapshot = parseSnapshot(row.issued_snapshot);
  } catch (err) {
    log.error(`${routeLabel}: snapshot unreadable`, { err: err instanceof Error ? err.message : String(err), id });
    return { error: apiErr("Could not render this document", 500) };
  }

  return {
    error: null,
    inputs: {
      snapshot,
      logoPath: org?.logo_path ?? null,
      balance: balanceRow
        ? { settledMinor: balanceRow.settled_minor ?? 0, balanceDueMinor: balanceRow.balance_due_minor ?? 0 }
        : null,
      templateKey: org?.invoice_template ?? null,
      invoiceOptions: org ? { showHsn: org.invoice_show_hsn, terms: org.invoice_terms } : null,
      compliance: config.complianceRefs ? { ewbNo: row.ewb_no ?? null, irn: row.irn ?? null, irnAckNo: row.irn_ack_no ?? null } : undefined,
      docKind: row.doc_kind,
      docNo: row.doc_no,
      partyDocNo: row.party_doc_no,
      docId: row.id,
    },
  };
}

async function loadLive(
  supabase: Supabase,
  id: string,
  orgId: string,
  config: Extract<DocumentPdfHandlerConfig, { mode: "live" }>,
  routeLabel: string,
): Promise<{ error: ApiError } | { error: null; inputs: RenderInputs }> {
  const { data: doc, error } = await dynTable(supabase, config.documentsTable)
    .select(
      `id, direction, doc_kind, doc_no, party_doc_no, doc_date, due_date, status, currency, taxable_value_minor, total_minor, tax_treatment, notes, counterparty_id, parties!${config.counterpartyFk}(name, tax_id, tax_id_kind, address, region_code)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    log.error(`${routeLabel}: query failed`, { err: error.message, id });
    return { error: apiErr("Could not load this document", 500) };
  }
  if (!doc) return { error: apiErr("Document not found", 404) };
  const row = doc as unknown as LiveDocumentRow & { status: string; parties: LivePartyRow | null };
  if (row.status !== "issued") {
    return { error: apiErr("This document has been cancelled, so there is nothing to print", 409) };
  }

  const [{ data: org }, { data: lines }, { data: taxes }, { data: balanceRow }] = await Promise.all([
    supabase.from("organisations").select(ORG_COLUMNS).eq("id", orgId).single(),
    dynTable(supabase, config.linesTable).select("description, amount_minor").eq("document_id", id).order("sort_order"),
    dynTable(supabase, config.taxesTable).select("component_code, component_label, rate_pct, amount_minor").eq("document_id", id),
    dynTable(supabase, config.balancesTable).select("settled_minor, balance_due_minor").eq("document_id", id).maybeSingle(),
  ]);
  if (!org) return { error: apiErr("Could not load your organisation", 500) };

  const counterparty = row.parties ?? { name: "—", tax_id: null, tax_id_kind: null, address: null, region_code: null };

  let snapshot: DocumentSnapshot;
  try {
    snapshot = config.buildSnapshot({
      document: row,
      lines: lines ?? [],
      taxes: taxes ?? [],
      counterparty,
      organisation: org,
    });
  } catch (err) {
    log.error(`${routeLabel}: snapshot build failed`, { err: err instanceof Error ? err.message : String(err), id });
    return { error: apiErr("Could not render this document", 500) };
  }

  return {
    error: null,
    inputs: {
      snapshot,
      logoPath: org.logo_path,
      balance: balanceRow
        ? { settledMinor: balanceRow.settled_minor ?? 0, balanceDueMinor: balanceRow.balance_due_minor ?? 0 }
        : null,
      templateKey: org.invoice_template,
      invoiceOptions: { showHsn: org.invoice_show_hsn, terms: org.invoice_terms },
      compliance: undefined,
      docKind: row.doc_kind,
      docNo: row.doc_no,
      partyDocNo: row.party_doc_no,
      docId: row.id,
    },
  };
}
