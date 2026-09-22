import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";

export const runtime = "nodejs";

const BUCKET = "activity-attachments";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);
  if (auth.ctx.vertical !== "plastics") return apiErr("Not available for this organisation", 403);

  const { id } = await params;
  const supabase = await createClient();

  const { data: activity, error: readErr } = await supabase
    .from("plastics_activities").select("id, attachment_path").eq("id", id).maybeSingle();
  if (readErr) return apiErr("Could not load this activity", 500);
  if (!activity) return apiErr("Activity not found", 404);
  if (!activity.attachment_path) return apiErr("This activity has no attachment", 404);

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(activity.attachment_path, 60);
  if (error || !data) return apiErr("Could not open that file", 500);

  return apiOk({ url: data.signedUrl });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);
  if (auth.ctx.vertical !== "plastics") return apiErr("Not available for this organisation", 403);

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

  const { data: activity, error: readErr } = await supabase
    .from("plastics_activities").select("id").eq("id", id).maybeSingle();
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
    .rpc("set_plastics_activity_attachment", { p_activity_id: id, p_attachment_path: path })
    .single();

  if (error) {
    return rpcError("POST /api/plastics/activities/[id]/attachment", error, "Could not attach that file");
  }
  return apiOk(data, 201);
}
