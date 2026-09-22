"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { inputClass } from "@/lib/ui/styles";
import type { PartyRole } from "@/lib/parties/roles";

export interface PartyOption {
  id: string;
  name: string;
  role?: PartyRole;
}

/**
 * Type a letter, see only the parties that match — a plain `<select>` only
 * jumps to the first option starting with what you typed and loses that
 * position on the next keystroke; this filters the whole list live, by
 * substring anywhere in the name.
 *
 * No internal Clients/Vendors grouping: the caller already hands this a
 * single-kind list (via filterPartiesForKind), so re-grouping here by
 * computed `role` would risk mislabeling — a party explicitly tagged a
 * vendor but with no billing history yet reads as role "other", and would
 * show under a confusing "Other parties" heading despite being exactly
 * where it belongs.
 */
export function PartyCombobox({
  id,
  parties,
  value,
  onChange,
  placeholder = "Type to search…",
  required,
}: {
  id: string;
  parties: PartyOption[];
  value: string;
  onChange: (partyId: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const selected = parties.find((p) => p.id === value) ?? null;
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  // Selection made elsewhere (e.g. form reset after submit) — keep the
  // visible text in sync without fighting the user's own typing. Adjusted
  // during render rather than in an effect, per React's own guidance for
  // "resetting state when a prop changes" — an effect here would mean an
  // extra, visible render with stale text before the sync catches up.
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setQuery(selected?.name ?? "");
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q === selected?.name.toLowerCase()) return parties;
    return parties.filter((p) => p.name.toLowerCase().includes(q));
  }, [parties, query, selected]);

  const flat = filtered;

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(selected?.name ?? "");
      }
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, [selected]);

  function choose(p: PartyOption) {
    onChange(p.id);
    setQuery(p.name);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        required={required}
        autoComplete="off"
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(0);
          if (value) onChange("");
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHighlight((h) => Math.min(h + 1, flat.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { if (open && flat[highlight]) { e.preventDefault(); choose(flat[highlight]); } }
          else if (e.key === "Escape") { setOpen(false); setQuery(selected?.name ?? ""); }
        }}
        className={inputClass}
      />
      {open && flat.length > 0 && (
        <ul id={listboxId} role="listbox" className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-line bg-white py-1 shadow-lg">
          {flat.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(p)}
                className={`block w-full px-3 py-1.5 text-left text-[13.5px] ${i === highlight ? "bg-brand-tint text-brand" : "text-ink hover:bg-paper"}`}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && flat.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-[13px] text-ink-3 shadow-lg">
          No match.
        </div>
      )}
    </div>
  );
}
