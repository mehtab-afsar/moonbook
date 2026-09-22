import { type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOwner, verifyAuth } from "@/lib/auth/verify";
import { parseBody } from "@/lib/api/validate";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";

export const runtime = "nodejs";

const COLUMNS = "id, email, role, invited_by, created_at, expires_at, accepted_at";

/** Every invite this org has ever sent — the client decides what "pending" means (unaccepted, unexpired). */
export async function GET() {
  const auth = await verifyAuth();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_invites")
    .select(COLUMNS)
    .order("created_at", { ascending: false });

  if (error) return apiErr("Could not load invites", 500);
  return apiOk(data);
}

const inviteSchema = z.object({
  email: z.email("that doesn't look like an email address").trim().toLowerCase(),
  role: z.enum(["owner", "staff"]).default("staff"),
});

export async function POST(req: NextRequest) {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const parsed = await parseBody(req, inviteSchema);
  if (!parsed.ok) return apiErr(parsed.error, 422);
  const v = parsed.data;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("org_invites")
    .insert({
      org_id: auth.ctx.orgId,
      email: v.email,
      role: v.role,
      invited_by: auth.ctx.userId,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiErr("An invite is already pending for that email", 409);
    }
    return rpcError("POST /api/settings/invites", error, "Could not send this invite");
  }
  return apiOk(data, 201);
}
