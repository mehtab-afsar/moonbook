import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";

export const runtime = "nodejs";

const patchSchema = z.object({
  label: z.string().trim().min(1).max(80),
  options: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  is_required: z.boolean().default(false),
  is_reportable: z.boolean().default(false),
  show_on_document: z.boolean().default(true),
});

/** Presentation attributes only — key and field_type are fixed at creation.
 *  See 20261001000009_self_serve_activity_fields.sql for why. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const { id } = await params;
  const parsed = await parseBody(req, patchSchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("update_activity_field", {
      p_field_id: id,
      p_label: v.label,
      p_options: v.options as never,
      p_is_required: v.is_required,
      p_is_reportable: v.is_reportable,
      p_show_on_document: v.show_on_document,
    })
    .single();

  if (error) return rpcError("PATCH /api/settings/activity-fields/[id]", error, "Could not save this field");
  return apiOk(data);
}

/** Soft delete — a document issued while this field existed must still be
 *  able to render the label it was captured under. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("archive_activity_field", { p_field_id: id }).single();

  if (error) return rpcError("DELETE /api/settings/activity-fields/[id]", error, "Could not archive this field");
  return apiOk(data);
}
