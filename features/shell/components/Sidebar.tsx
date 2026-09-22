"use client";

import { useRef, useState } from "react";
import type { FocusEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FileText, Banknote, PackageCheck, Receipt, Users, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logomark } from "@/features/marketing/components/Logomark";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/payments", label: "Receipts", icon: Banknote },
  { href: "/activities", label: "Activity log", icon: PackageCheck },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/parties", label: "Parties", icon: Users },
] as const;

const CLOSE_DELAY_MS = 100;

/**
 * A 60px icon rail that expands to 240px on hover or keyboard focus.
 *
 * `open` is React state, deliberately not CSS `:hover`/`:focus-within`:
 * those keep the rail pinned open after a Link is clicked, since the
 * clicked link keeps browser focus until something else takes it — the
 * mouse leaving doesn't help, CSS has no "leave" signal independent of
 * focus. Explicit pointer/focus handlers close it whenever the mouse
 * actually leaves, click or not — the same fix LedgerFlow's Sidebar uses.
 */
export function Sidebar({ orgName, userName }: { orgName: string; userName: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearCloseTimer() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function openNow() {
    clearCloseTimer();
    setOpen(true);
  }

  function closeSoon() {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }

  function handleBlur(e: FocusEvent<HTMLElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className="relative w-[60px] shrink-0" aria-expanded={open}>
      <aside
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        onFocus={openNow}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            (document.activeElement as HTMLElement | null)?.blur();
          }
        }}
        className={cn(
          "absolute inset-y-0 left-0 z-40 flex w-[60px] flex-col overflow-hidden",
          "border-r border-line bg-white transition-[width,box-shadow] duration-200 ease-out",
          open && "w-60 shadow-lg",
        )}
      >
        {/* pl-3.5 puts the 32px mark and the 16px nav icons on the same
            centreline — 30px, the middle of the rail — so nothing shifts
            horizontally as the panel opens. */}
        <div className="flex items-center gap-2.5 py-4 pl-3.5 pr-4">
          <Logomark className="size-8 shrink-0" />
          <div className={cn("min-w-0 opacity-0 transition-opacity duration-200", open && "opacity-100")}>
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
                onClick={() => setOpen(false)}
                className={cn(
                  "mx-2 flex items-center gap-2.5 overflow-hidden rounded-md py-2 pl-3.5 pr-2.5 text-sm transition-colors duration-150",
                  active ? "bg-primary text-primary-foreground" : "text-ink-2 hover:bg-line-soft",
                )}
              >
                <Icon className="size-4 shrink-0" strokeWidth={1.5} />
                <span className={cn("truncate opacity-0 transition-opacity duration-200", open && "opacity-100")}>
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line-soft py-2">
          <Link
            href="/settings"
            aria-current={isActive("/settings") ? "page" : undefined}
            onClick={() => setOpen(false)}
            className={cn(
              "mx-2 mb-1 flex items-center gap-2.5 overflow-hidden rounded-md py-2 pl-3.5 pr-2.5 text-sm transition-colors duration-150",
              isActive("/settings") ? "bg-primary text-primary-foreground" : "text-ink-2 hover:bg-line-soft",
            )}
          >
            <Settings className="size-4 shrink-0" strokeWidth={1.5} />
            <span className={cn("truncate opacity-0 transition-opacity duration-200", open && "opacity-100")}>
              Settings
            </span>
          </Link>
        </div>
      </aside>
    </div>
  );
}
