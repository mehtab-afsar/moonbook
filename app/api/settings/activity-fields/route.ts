import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";
import { FIELD_TYPES } from "@/lib/domain";

export const runtime = "nodejs";

const bodySchema = z.object({
  activity_type_id: z.uuid(),
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/, "lowercase, start with a letter, letters/numbers/underscores only"),
  label: z.string().trim().min(1).max(80),
  field_type: z.enum(FIELD_TYPES),
  options: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  is_required: z.boolean().default(false),
  is_reportable: z.boolean().default(false),
  show_on_document: z.boolean().default(true),
});

/** Adds a field to one of THIS org's own copied activity types. See
 *  20261001000009_self_serve_activity_fields.sql for the full reasoning. */
export async function POST(req: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const parsed = await parseBody(req, bodySchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("add_activity_field", {
      p_activity_type_id: v.activity_type_id,
      p_key: v.key,
      p_label: v.label,
      p_field_type: v.field_type,
      p_options: v.options as never,
      p_is_required: v.is_required,
      p_is_reportable: v.is_reportable,
      p_show_on_document: v.show_on_document,
    })
    .single();

  if (error) return rpcError("POST /api/settings/activity-fields", error, "Could not add this field");
  return apiOk(data, 201);
}
