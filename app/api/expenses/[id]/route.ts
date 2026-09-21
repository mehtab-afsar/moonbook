import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";

export const runtime = "nodejs";

const COLUMNS =
  "id, category, description, currency, amount_minor, incurred_on, party_id, created_at";

/** Every field optional: a PATCH changes what it names and nothing else. */
const patchSchema = z.object({
  category: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  amount_minor: z.number().int().positive().optional(),
  incurred_on: z.iso.date().optional(),
  party_id: z.uuid().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const { id } = await params;
  const parsed = await parseBody(req, patchSchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);

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
    .from("expenses")
    .update(patch)
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();

  if (error) return rpcError("PATCH /api/expenses/[id]", error, "Could not save this expense");
  if (!data) return apiErr("Expense not found", 404);
  return apiOk(data);
}
