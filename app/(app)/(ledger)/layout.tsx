import { redirect } from "next/navigation";
import { verifyAuth } from "@/lib/auth/verify";

/**
 * The shared-engine ledger pages (dashboard, activities, documents, payments,
 * expenses) — nested inside (app) so they keep its auth check and Sidebar,
 * but scoped separately from parties/settings so ONLY these redirect a
 * logistics-vertical org away. parties and settings read shared tenancy
 * tables and are reachable from both verticals.
 */
export default async function LedgerLayout({ children }: { children: React.ReactNode }) {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");
  // A forked-vertical org's data lives entirely outside the shared tables —
  // every page under this layout would show it nothing true.
  if (auth.ctx.vertical !== "shared") redirect(`/${auth.ctx.vertical}/dashboard`);

  return children;
}
