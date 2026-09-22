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
  const { data, error } = await supabase.rpc("archive_activity_link_type", { p_link_type_id: id }).single();

  if (error) return rpcError("DELETE /api/settings/activity-link-types/[id]", error, "Could not archive this relationship");
  return apiOk(data);
}
