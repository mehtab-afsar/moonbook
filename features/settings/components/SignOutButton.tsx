"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { buttonSecondaryClass } from "@/lib/ui/styles";

/** Lives in Settings, not the sidebar — signing out is account admin, the same as everything else on this page. */
export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <button type="button" onClick={signOut} className={`inline-flex items-center gap-2 ${buttonSecondaryClass}`}>
      <LogOut className="size-4" strokeWidth={1.75} />
      Sign out
    </button>
  );
}
