import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";

export const runtime = "nodejs";

const COLUMNS =
  "id, name, country_code, region_code, tax_id, tax_id_kind, payment_terms_days, credit_limit_minor, email, phone, address, notes, created_at";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.from("parties").select(COLUMNS).eq("id", id).maybeSingle();

  if (error) return apiErr("Could not load this party", 500);
  // RLS returned nothing. For another tenant's party that is a 404 and never
  // a 403 — a 403 would confirm the record exists.
  if (!data) return apiErr("Party not found", 404);
  return apiOk(data);
}

/** Every field optional: a PATCH changes what it names and nothing else. */
const patchSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  country_code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional().nullable(),
  region_code: z.string().trim().toUpperCase().max(10).optional().nullable(),
  tax_id: z.string().trim().max(40).optional().nullable(),
  tax_id_kind: z.string().trim().max(20).optional().nullable(),
  payment_terms_days: z.number().int().min(0).max(365).optional(),
  credit_limit_minor: z.number().int().min(0).optional().nullable(),
  email: z.email().optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

/**
 * Editing a party does NOT rewrite documents already issued to them: those
 * read from their own frozen snapshot. Correcting a customer's address today
 * cannot change what last year's invoice said it was.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const { id } = await params;
  const parsed = await parseBody(req, patchSchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);

  // Blank strings from a cleared form field mean "remove this", not "".
  // Typed as the schema's own output so the update below stays checked against
  // the generated column types rather than widening to `unknown`.
  const patch: z.infer<typeof patchSchema> = {};
  for (const key of Object.keys(parsed.data) as (keyof typeof parsed.data)[]) {
    const value = parsed.data[key];
    Object.assign(patch, {
      [key]: typeof value === "string" && value.trim() === "" ? null : value,
    });
  }
  if (Object.keys(patch).length === 0) return apiErr("Nothing to change", 422);

  const supabase = await createClient();
  // No `.eq("org_id", …)`: the update policy's `using` clause is the tenancy
  // boundary, and a row in another org simply isn't visible to update.
  const { data, error } = await supabase
    .from("parties")
    .update(patch)
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return apiErr("A party with that tax identifier already exists", 409);
    }
    return rpcError("PATCH /api/parties/[id]", error, "Could not save this party");
  }
  if (!data) return apiErr("Party not found", 404);
  return apiOk(data);
}
