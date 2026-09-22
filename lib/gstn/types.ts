import type { GstnProvider, GstnEnvironment } from "@/lib/domain";

/**
 * The shape a real GSTN client will implement, once one exists. Modelled on
 * the two calls Moonbook actually needs — generate an IRN (e-invoice) and
 * generate an e-way bill — using field names close to what the government's
 * own e-invoice/e-way bill schemas use, since most GSPs pass those through
 * close to verbatim rather than inventing their own shape.
 *
 * This is a CONTRACT, not a guess at any one GSP's actual REST API. Each
 * provider's real request/response format will differ in details (auth
 * header names, wrapper envelopes, error codes) — the provider-specific
 * adapter (lib/gstn/providers/<name>.ts, not yet written) is where that
 * translation happens; callers everywhere else in the app only ever see
 * this interface, so swapping providers later is a new adapter file, not a
 * change to every call site.
 */
export interface GstnClientConfig {
  provider: GstnProvider;
  environment: GstnEnvironment;
  gstin: string;
  /**
   * Never a database column — see 20261001000008_gstn_connections.sql's own
   * header. Resolved from environment variables / a secrets manager at the
   * point a real client is constructed, once real credentials exist.
   */
  credentials: Record<string, string>;
}

export interface GenerateIrnInput {
  documentId: string;
  /** The exact figures already computed by lib/tax/ and frozen on the
   *  document — never recomputed by the GSTN client, same rule as
   *  everywhere else tax is handled in this codebase. */
  invoiceNo: string;
  invoiceDate: string; // ISO yyyy-mm-dd
  totalMinor: number;
  taxableValueMinor: number;
  sellerGstin: string;
  buyerGstin: string;
  lines: { description: string; hsnSac: string | null; amountMinor: number; taxRatePct: number }[];
}

export interface GenerateIrnResult {
  irn: string;
  ackNo: string;
  ackDate: string;
  qrCodeData: string;
}

export interface GenerateEwayBillInput {
  documentId: string;
  irn: string | null; // an e-way bill can exist without an e-invoice, or reference one
  fromGstin: string;
  toGstin: string;
  totalMinor: number;
  transportMode: "road" | "rail" | "air" | "ship";
  vehicleNo: string | null;
}

export interface GenerateEwayBillResult {
  ewbNo: string;
  validUntil: string; // ISO datetime
}

export interface GstnClient {
  generateIrn(input: GenerateIrnInput): Promise<GenerateIrnResult>;
  cancelIrn(irn: string, reason: string): Promise<void>;
  generateEwayBill(input: GenerateEwayBillInput): Promise<GenerateEwayBillResult>;
}

/** Thrown by the stub client, and by a real one for an actual API failure —
 *  callers catch this ONE type rather than a different error shape per
 *  provider. */
export class GstnError extends Error {
  constructor(
    message: string,
    /** "not_configured" until a real client exists; a real client will also
     *  use "provider_error" / "rejected" / "network" once it exists. */
    public readonly kind: "not_configured" | "provider_error" | "rejected" | "network" = "provider_error",
  ) {
    super(message);
    this.name = "GstnError";
  }
}
