import { expect } from "@playwright/test";
import type { Tenant } from "../fixtures";

/**
 * Preconditions, set up through the tenant's own client or its own signed-in
 * request context — never the service role.
 *
 * That matters: seeding with the service role would bypass RLS, so a spec
 * could assert on rows the product itself could not have created. Everything
 * here goes through the same policies and the same RPCs the app uses, which
 * means a broken policy fails the setup rather than hiding inside it.
 */

export async function addParty(
  tenant: Tenant,
  opts: { name: string; regionCode?: string | null; termsDays?: number; taxId?: string | null; address?: string },
): Promise<string> {
  const { data, error } = await tenant.db
    .from("parties")
    .insert({
      org_id: tenant.orgId,
      name: opts.name,
      country_code: "IN",
      region_code: opts.regionCode ?? null,
      payment_terms_days: opts.termsDays ?? 30,
      tax_id: opts.taxId ?? null,
      address: opts.address ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`addParty(${opts.name}): ${error.message}`);
  return data.id as string;
}

/** The org's own copy of an activity type, by key. Templates are not usable directly. */
export async function activityTypeId(tenant: Tenant, key: string): Promise<string> {
  const { data, error } = await tenant.db
    .from("activity_types")
    .select("id")
    .not("org_id", "is", null)
    .eq("key", key)
    .single();

  if (error) throw new Error(`activityTypeId(${key}): ${error.message}`);
  return data.id as string;
}

export async function recordActivity(
  tenant: Tenant,
  opts: {
    typeId: string;
    partyId: string;
    amountMinor: number;
    occurredOn: string;
    details?: Record<string, unknown>;
    reference?: string;
    /** Who pays, when that is not who the work was done for. */
    billToPartyId?: string;
  },
): Promise<string> {
  const { data, error } = await tenant.db
    .rpc("record_activity", {
      p_activity_type_id: opts.typeId,
      p_party_id: opts.partyId,
      p_occurred_on: opts.occurredOn,
      p_amount_minor: opts.amountMinor,
      p_details: (opts.details ?? {}) as never,
      p_bill_to_party_id: opts.billToPartyId,
      p_reference: opts.reference,
      p_status: "completed",
    })
    .single<{ activity_id: string }>();

  if (error) throw new Error(`recordActivity: ${error.message}`);
  return data!.activity_id;
}

/**
 * Issue through the HTTP API, as the signed-in browser would.
 *
 * `page.request` shares the browser context's cookies, so this is the same
 * authenticated caller — and crucially it runs the route's tax computation
 * rather than a copy of it.
 */
export async function issueInvoice(
  tenant: Tenant,
  opts: {
    partyId: string;
    activityIds: string[];
    docDate: string;
    dueDate?: string | null;
    treatment?: "forward" | "reverse_charge" | "exempt";
    notes?: string;
  },
): Promise<{ documentId: string; docNo: string; totalMinor: number; taxNote: string | null }> {
  const res = await tenant.page.request.post("/api/documents", {
    data: {
      doc_kind: "invoice",
      counterparty_id: opts.partyId,
      doc_date: opts.docDate,
      due_date: opts.dueDate ?? null,
      activity_ids: opts.activityIds,
      tax_treatment: opts.treatment ?? "forward",
      ...(opts.notes ? { notes: opts.notes } : {}),
    },
  });
  expect(res.ok(), `issue invoice failed: ${res.status()} ${await res.text()}`).toBeTruthy();

  const body = await res.json();
  return {
    documentId: body.data.document_id,
    docNo: body.data.doc_no,
    totalMinor: body.data.total_minor,
    taxNote: body.data.tax_note,
  };
}

export async function recordPayment(
  tenant: Tenant,
  opts: {
    partyId: string;
    amountMinor: number;
    paidOn: string;
    allocations?: { document_id: string; amount_minor: number }[];
  },
) {
  return tenant.page.request.post("/api/payments", {
    data: {
      direction: "in",
      party_id: opts.partyId,
      amount_minor: opts.amountMinor,
      paid_on: opts.paidOn,
      method: "bank",
      allocations: opts.allocations ?? [],
    },
  });
}

/** The tax components actually stored against a document. */
export async function documentTaxes(tenant: Tenant, documentId: string) {
  const { data, error } = await tenant.db
    .from("document_taxes")
    .select("component_code, component_label, rate_pct, amount_minor, sort_order")
    .eq("document_id", documentId)
    .order("sort_order");

  if (error) throw new Error(`documentTaxes: ${error.message}`);
  return (data ?? []).map((t) => ({ ...t, rate_pct: Number(t.rate_pct) }));
}

export async function balanceOf(tenant: Tenant, documentId: string): Promise<number> {
  const { data, error } = await tenant.db
    .from("document_balances")
    .select("balance_due_minor")
    .eq("document_id", documentId)
    .single();

  if (error) throw new Error(`balanceOf: ${error.message}`);
  return data.balance_due_minor ?? 0;
}

/** A freight trip's details, matching the template's own field keys and options. */
export function trip(origin: string, destination: string, vehicle = "KA01AB1234") {
  return { origin, destination, vehicle_no: vehicle, load_type: "Full truckload" };
}
