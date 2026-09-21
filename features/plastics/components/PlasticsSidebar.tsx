"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { LayoutDashboard, FileText, Banknote, Recycle, Users, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const NAV = [
  { href: "/plastics/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/plastics/activities", label: "Purchases & sales", icon: Recycle },
  { href: "/plastics/documents", label: "Documents", icon: FileText },
  { href: "/plastics/payments", label: "Payments", icon: Banknote },
  { href: "/parties", label: "Parties", icon: Users },
] as const;

const CLOSE_DELAY_MS = 100;

export function PlasticsSidebar({ orgName, userName }: { orgName: string; userName: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className="group relative w-[60px] shrink-0">
      <aside
        className={cn(
          "absolute inset-y-0 left-0 z-40 flex w-[60px] flex-col overflow-hidden",
          "border-r border-line bg-white transition-[width,box-shadow] duration-200 ease-out",
          "group-hover:w-60 group-hover:shadow-lg",
          "group-focus-within:w-60 group-focus-within:shadow-lg",
        )}
        style={{ transitionDelay: `${0}ms`, ["--close-delay" as string]: `${CLOSE_DELAY_MS}ms` }}
      >
        <div className="flex items-center gap-2.5 py-4 pl-3.5 pr-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Recycle className="size-4" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
            <p className="truncate text-sm font-semibold leading-tight text-ink">{orgName}</p>
            <p className="truncate text-xs text-ink-3">{userName}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 py-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "mx-2 flex items-center gap-2.5 rounded-md py-2 pl-3.5 pr-2.5 text-sm transition-colors duration-150",
                  active ? "bg-primary text-primary-foreground" : "text-ink-2 hover:bg-line-soft",
                )}
              >
                <Icon className="size-4 shrink-0" strokeWidth={1.5} />
                <span className="truncate opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={signOut}
          className="mx-2 mb-3 flex items-center gap-2.5 rounded-md py-2 pl-3.5 pr-2.5 text-sm text-ink-2 transition-colors duration-150 hover:bg-line-soft"
        >
          <LogOut className="size-4 shrink-0" strokeWidth={1.5} />
          <span className="truncate opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
            Sign out
          </span>
        </button>
      </aside>
    </div>
  );
}
