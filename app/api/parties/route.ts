import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";

export const runtime = "nodejs";

const COLUMNS =
  "id, name, kind, country_code, region_code, tax_id, tax_id_kind, payment_terms_days, credit_limit_minor, email, phone, address, notes, payout_bank_name, payout_account_no, payout_ifsc_or_routing, payout_upi_id, created_at";

export async function GET() {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const supabase = await createClient();
  const { data, error } = await supabase.from("parties").select(COLUMNS).order("name");

  if (error) return apiErr("Could not load parties", 500);
  return apiOk(data);
}

/**
 * `region_code` is not cosmetic — under a split_rate regime it is what decides
 * whether a sale is taxed as two components or one. It is optional because
 * most regimes ignore it entirely, and the UI asks for it only where it counts.
 */
const partySchema = z.object({
  name: z.string().trim().min(2, "a name is required").max(200),
  kind: z.enum(["client", "vendor"]).optional().nullable(),
  country_code: z
    .string().trim().toUpperCase()
    .regex(/^[A-Z]{2}$/, "must be a 2-letter country code")
    .optional().nullable(),
  region_code: z.string().trim().toUpperCase().max(10).optional().nullable(),
  tax_id: z.string().trim().max(40).optional().nullable(),
  tax_id_kind: z.string().trim().max(20).optional().nullable(),
  payment_terms_days: z.number().int().min(0).max(365).default(30),
  credit_limit_minor: z.number().int().min(0).optional().nullable(),
  email: z.email("that doesn't look like an email address").optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  payout_bank_name: z.string().trim().max(200).optional().nullable(),
  payout_account_no: z.string().trim().max(64).optional().nullable(),
  payout_ifsc_or_routing: z.string().trim().max(32).optional().nullable(),
  payout_upi_id: z.string().trim().max(100).optional().nullable(),
});

/** Blank strings from an untouched form field mean "not given", not "". */
function nullifyBlanks<T extends Record<string, unknown>>(v: T): T {
  const out = { ...v };
  for (const [k, value] of Object.entries(out)) {
    if (typeof value === "string" && value.trim() === "") {
      (out as Record<string, unknown>)[k] = null;
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const parsed = await parseBody(req, partySchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);
  const v = nullifyBlanks(parsed.data);

  const supabase = await createClient();

  // Default the jurisdiction from the organisation rather than asking again:
  // almost every party is in the same country as the business billing it, and
  // a NULL country_code silently changes how tax is decided.
  let countryCode = v.country_code ?? null;
  if (countryCode === null) {
    const { data: org } = await supabase
      .from("organisations").select("country_code").eq("id", auth.ctx.orgId).single();
    countryCode = org?.country_code ?? null;
  }

  // A direct insert, not an RPC: parties carry no sequence, no state machine
  // and no cross-table invariant, so the RLS `with check` IS the whole rule.
  const { data, error } = await supabase
    .from("parties")
    .insert({ ...v, country_code: countryCode, org_id: auth.ctx.orgId, created_by: auth.ctx.userId })
    .select(COLUMNS)
    .single();

  if (error) {
    // One tax identifier per org — a partial unique index, so the many parties
    // without one don't collide on NULL.
    if (error.code === "23505") {
      return apiErr("A party with that tax identifier already exists", 409);
    }
    return rpcError("POST /api/parties", error, "Could not save this party");
  }
  return apiOk(data, 201);
}
