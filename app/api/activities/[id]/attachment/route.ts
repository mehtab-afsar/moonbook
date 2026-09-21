import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";

export const runtime = "nodejs";

const BUCKET = "activity-attachments";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]);

/**
 * A short-lived signed URL, minted fresh on every request rather than stored
 * — the bucket is private, so this is the only way to reach the file, and
 * the RLS-checked read of the activity above is what stands between a
 * signed URL and another tenant's id.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const { id } = await params;
  const supabase = await createClient();

  const { data: activity, error: readErr } = await supabase
    .from("activities").select("id, attachment_path").eq("id", id).maybeSingle();
  if (readErr) return apiErr("Could not load this activity", 500);
  if (!activity) return apiErr("Activity not found", 404);
  if (!activity.attachment_path) return apiErr("This activity has no attachment", 404);

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(activity.attachment_path, 60);
  if (error || !data) return apiErr("Could not open that file", 500);

  return apiOk({ url: data.signedUrl });
}

/**
 * Upload happens here, against the caller's own RLS-checked session — never
 * with the service role — so the storage policies (path must start with the
 * caller's own org id) are the real gate, not application code.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const { id } = await params;
  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) return apiErr("No file was uploaded", 422);
  if (file.size === 0) return apiErr("That file is empty", 422);
  if (file.size > MAX_BYTES) return apiErr("Files must be 10 MB or smaller", 422);
  if (!ALLOWED_TYPES.has(file.type)) {
    return apiErr("Only JPEG, PNG, WEBP, HEIC or PDF files are accepted", 422);
  }

  const supabase = await createClient();

  // RLS confirms the activity is this org's own before anything is uploaded
  // for it — an id from another tenant is a 404, never a 403.
  const { data: activity, error: readErr } = await supabase
    .from("activities").select("id").eq("id", id).maybeSingle();
  if (readErr) return apiErr("Could not load this activity", 500);
  if (!activity) return apiErr("Activity not found", 404);

  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
  const path = `${auth.ctx.orgId}/${id}/${crypto.randomUUID()}${ext}`;

  const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadErr) return apiErr("Could not upload that file", 500);

  const { data, error } = await supabase
    .rpc("set_activity_attachment", { p_activity_id: id, p_attachment_path: path })
    .single();

  if (error) {
    // The activity row was already confirmed to belong to this org above, so
    // failing here means the upload succeeded but the pointer could not be
    // saved — worth leaving the orphaned object rather than compounding the
    // failure with a second fallible call to remove it.
    return rpcError("POST /api/activities/[id]/attachment", error, "Could not attach that file");
  }
  return apiOk(data, 201);
}
