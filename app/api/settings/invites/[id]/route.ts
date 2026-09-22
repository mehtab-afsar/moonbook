import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/auth/verify";
import { apiErr, apiOk } from "@/lib/api/response";
import { rpcError } from "@/lib/api/errors";

export const runtime = "nodejs";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner();
  if (!auth.ok) return apiErr(auth.error, auth.status);

  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("cancel_org_invite", { p_invite_id: id }).single();
  if (error) return rpcError("DELETE /api/settings/invites/[id]", error, "Could not withdraw this invite");
  return apiOk(data);
}
