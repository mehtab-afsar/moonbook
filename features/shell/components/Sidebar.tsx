"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { LayoutDashboard, FileText, Banknote, PackageCheck, Users, Settings, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

/**
 * A 60px icon rail that expands to 240px on hover or keyboard focus.
 *
 * The expansion is an OVERLAY, not a width change in the flex row: the outer
 * div is a permanent 60px spacer and the aside is absolutely positioned inside
 * it. If the aside itself grew, every table to its right would re-layout on
 * each hover — a visible shudder on a page of forty rows.
 *
 * Open state is React, deliberately NOT CSS `:focus-within`: clicking a Link
 * leaves focus inside the rail, so a CSS-only version stays pinned open after
 * you navigate.
 */
const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/payments", label: "Payments", icon: Banknote },
  { href: "/activities", label: "Activity log", icon: PackageCheck },
  { href: "/parties", label: "Parties", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const CLOSE_DELAY_MS = 100;

export function Sidebar({ orgName, userName }: { orgName: string; userName: string }) {
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
        {/* pl-3.5 puts the 32px mark and the 16px nav icons on the same
            centreline — 30px, the middle of the rail — so nothing shifts
            horizontally as the panel opens. */}
        <div className="flex items-center gap-2.5 py-4 pl-3.5 pr-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <span className="font-mono text-[15px] font-medium leading-none">M</span>
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
