"use client";

import { useState } from "react";
import { buttonSecondaryClass } from "@/lib/ui/styles";

/** MMYYYY for the current month, in the browser's own local time. */
function currentPeriod(): string {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, "0")}${now.getFullYear()}`;
}

/**
 * A period picker rather than a static link — GSTR-1 is filed per month, so
 * "export" has to ask which one. Downloads directly; no preview, since the
 * file is meant for an accountant's filing tool, not for reading here.
 */
export function Gstr1ExportButton() {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => currentPeriod().slice(0, 2));
  const [year, setYear] = useState(() => currentPeriod().slice(2));

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonSecondaryClass}>
        Export GSTR-1 (B2B)
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-md border border-line px-2 py-1.5 text-[13px]">
        {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      <select value={year} onChange={(e) => setYear(e.target.value)} className="rounded-md border border-line px-2 py-1.5 text-[13px]">
        {Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - i)).map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      <a href={`/api/documents/gstr1?period=${month}${year}`} className={buttonSecondaryClass}>
        Download
      </a>
      <button type="button" onClick={() => setOpen(false)} className="text-[13px] text-ink-2 hover:text-ink">
        Cancel
      </button>
    </div>
  );
}
