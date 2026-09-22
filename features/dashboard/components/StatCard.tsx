import Link from "next/link";
import type { LucideIcon } from "lucide-react";

/**
 * `bordered={false}` drops the tile's own border/box so several can sit
 * inside one shared outer card instead of each being a card of its own.
 */
export function StatCard({
  label,
  value,
  sub,
  tone = "ink",
  href,
  bordered = true,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ink" | "overdue" | "settled";
  href?: string;
  bordered?: boolean;
  icon?: LucideIcon;
}) {
  const toneClass =
    tone === "overdue" ? "text-overdue" : tone === "settled" ? "text-settled-ink" : "text-ink";
  const iconToneClass =
    tone === "overdue" ? "bg-overdue-tint text-overdue" : tone === "settled" ? "bg-settled-tint text-settled-ink" : "bg-brand-tint text-brand";
  const content = (
    <>
      <div className="flex items-center gap-2.5">
        {Icon && (
          <span className={`flex size-7 shrink-0 items-center justify-center rounded-md ${iconToneClass}`}>
            <Icon className="size-[15px]" strokeWidth={1.75} />
          </span>
        )}
        <p className="text-[12.5px] text-ink-2">{label}</p>
      </div>
      <p className={`mt-1.5 font-mono text-[24px] font-semibold ${toneClass}`}>{value}</p>
      {sub && <p className="mt-1 text-[12px] text-ink-3">{sub}</p>}
    </>
  );
  const boxClass = bordered ? "rounded-[10px] border border-line bg-white p-5" : "rounded-md p-2";
  if (href) {
    return (
      <Link href={href} className={`${boxClass} block transition-colors duration-150 hover:bg-paper`}>
        {content}
      </Link>
    );
  }
  return <div className={boxClass}>{content}</div>;
}
