import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The header shared by every public-facing page — landing, sign in, sign up.
 * One place for the mark so it can never drift between them, the way plain
 * "Moonbook" text on three separate pages already had.
 */
export function SiteHeader({ actions }: { actions?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between px-7">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <span className="font-mono text-[13px] font-medium leading-none">M</span>
          </span>
          <span className="font-semibold text-ink">Moonbook</span>
        </Link>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
