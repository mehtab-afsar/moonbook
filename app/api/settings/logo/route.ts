import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOwner, verifyAuth } from "@/lib/auth/verify";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";

export const runtime = "nodejs";

const BUCKET = "org-logos";
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg",
};

/** A signed URL for the current org's own logo, for previewing it in Settings. */
export async function GET() {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const supabase = await createClient();
  const { data: org, error: readErr } = await supabase
    .from("organisations").select("logo_path").eq("id", auth.ctx.orgId).single();
  if (readErr) return apiErr("Could not load your organisation", 500);
  if (!org.logo_path) return apiErr("No logo set", 404);

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(org.logo_path, 60);
  if (error || !data) return apiErr("Could not open the logo", 500);
  return apiOk({ url: data.signedUrl });
}

export async function POST(req: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) return apiErr("No file was uploaded", 422);
  if (file.size === 0) return apiErr("That file is empty", 422);
  if (file.size > MAX_BYTES) return apiErr("Logos must be 2 MB or smaller", 422);
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) return apiErr("Only PNG, JPEG, WEBP or SVG files are accepted", 422);

  const supabase = await createClient();

  const { data: org } = await supabase.from("organisations").select("logo_path").eq("id", auth.ctx.orgId).single();
  const previousPath = org?.logo_path ?? null;

  // A fresh path per upload, not a fixed "logo.png" — content-addressed
  // enough to dodge any signed-URL/CDN caching on the old bytes, and the
  // RPC below only swaps the pointer once the new object is safely stored.
  const path = `${auth.ctx.orgId}/logo-${crypto.randomUUID()}.${ext}`;

  const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadErr) return apiErr("Could not upload that file", 500);

  const { data, error } = await supabase.rpc("set_org_logo", { p_logo_path: path }).single();
  if (error) {
    return rpcError("POST /api/settings/logo", error, "Could not save the logo");
  }

  if (previousPath) {
    await supabase.storage.from(BUCKET).remove([previousPath]);
  }

  return apiOk(data, 201);
}

export async function DELETE() {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const supabase = await createClient();
  const { data: org } = await supabase.from("organisations").select("logo_path").eq("id", auth.ctx.orgId).single();
  const previousPath = org?.logo_path ?? null;

  const { error } = await supabase.rpc("set_org_logo", { p_logo_path: null as unknown as string }).single();
  if (error) return rpcError("DELETE /api/settings/logo", error, "Could not remove the logo");

  if (previousPath) {
    await supabase.storage.from(BUCKET).remove([previousPath]);
  }
  return apiOk({ removed: true });
}
