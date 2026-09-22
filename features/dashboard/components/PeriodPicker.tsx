"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Calendar, ChevronDown, Check } from "lucide-react";

const PRESETS = [
  { value: "7", label: "Last 7 days" },
  { value: "15", label: "Last 15 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
] as const;

/**
 * A single dropdown trigger, not a row of pill buttons — the row read as
 * five competing controls at a glance; naming the active range on the
 * button itself and folding the rest behind one click reads as one.
 */
export function PeriodPicker({
  activePreset,
  from,
  to,
}: {
  activePreset: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function setPreset(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", value);
    params.delete("from");
    params.delete("to");
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  function applyCustom() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", customFrom);
    params.set("to", customTo);
    params.delete("period");
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  const activeLabel =
    activePreset === "custom"
      ? `${from} – ${to}`
      : (PRESETS.find((p) => p.value === activePreset)?.label ?? "Last 30 days");

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:bg-paper"
      >
        <Calendar className="size-3.5 text-ink-3" strokeWidth={1.75} />
        {activeLabel}
        <ChevronDown className={`size-3.5 text-ink-3 transition-transform duration-150 ${open ? "rotate-180" : ""}`} strokeWidth={1.75} />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1.5 w-64 rounded-[10px] border border-line bg-white p-1.5 shadow-lg">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPreset(p.value)}
              className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink transition-colors duration-150 hover:bg-paper"
            >
              {p.label}
              {activePreset === p.value && <Check className="size-3.5 text-brand" strokeWidth={2} />}
            </button>
          ))}

          <div className="my-1.5 border-t border-line-soft" />

          <div className="px-2.5 py-1.5">
            <p className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ink-3">Custom range</p>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-full rounded border border-line px-1.5 py-1 font-mono text-[12.5px] text-ink"
              />
              <span className="text-ink-3">–</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-full rounded border border-line px-1.5 py-1 font-mono text-[12.5px] text-ink"
              />
            </div>
            <button
              type="button"
              onClick={applyCustom}
              className="mt-2 w-full rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors duration-150 hover:bg-ink-2"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
