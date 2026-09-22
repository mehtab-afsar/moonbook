import Link from "next/link";
import type { ReactNode } from "react";
import { Logomark } from "./Logomark";

/**
 * The header shared by every public-facing page — landing, sign in, sign up.
 * One place for the mark so it can never drift between them, the way plain
 * "Moonbook" text on three separate pages already had.
 */
export function SiteHeader({ actions, nav }: { actions?: ReactNode; nav?: ReactNode }) {
  return (
    <header className="sticky top-0 z-50 px-4 pt-4 sm:px-7">
      <div className="mx-auto flex h-14 max-w-[880px] items-center justify-between rounded-full border border-line bg-white/80 px-5 shadow-[0_8px_24px_-12px_rgba(23,26,46,0.18)] backdrop-blur-xl sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Logomark className="size-6 shrink-0" />
          <span className="font-semibold text-ink">Moonbook</span>
        </Link>
        {nav && <nav className="hidden items-center gap-6 md:flex">{nav}</nav>}
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
