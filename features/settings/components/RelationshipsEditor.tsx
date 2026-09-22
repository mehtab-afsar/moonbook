"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, buttonSecondaryClass } from "@/lib/ui/styles";
import { LINK_AGGREGATES, type LinkAggregate } from "@/lib/domain";

const AGGREGATE_LABEL: Record<LinkAggregate, string> = {
  none: "No rollup",
  sum_amount: "Sum of linked activities' amount",
  count: "Count of linked activities",
};

export interface LinkTypeRow {
  id: string;
  key: string;
  label: string;
  aggregate: LinkAggregate;
  from_activity_type_id: string;
  to_activity_type_id: string;
}

export interface ActivityTypeOption {
  id: string;
  label_plural: string;
}

/**
 * Relationships between two of this org's own activity types — config, the
 * same layer as fields. A closed set of rollups (sum/count), never a
 * formula — see 20261001000010_activity_link_types.sql for why.
 */
export function RelationshipsEditor({
  types,
  linkTypes,
  isOwner,
}: {
  types: ActivityTypeOption[];
  linkTypes: LinkTypeRow[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const nameOf = (id: string) => types.find((t) => t.id === id)?.label_plural ?? "—";

  async function archive(id: string) {
    if (!confirm("Archive this relationship? Existing links of this kind stay, but no new ones can be made.")) return;
    setBusy(id);
    setError("");
    const res = await fetch(`/api/settings/activity-link-types/${id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not archive this.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {linkTypes.length === 0 ? (
        <p className="text-[13px] text-ink-3">No relationships defined between your activity types yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {linkTypes.map((lt) => (
            <li key={lt.id} className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
              <span className="text-ink">
                {nameOf(lt.from_activity_type_id)} <span className="text-ink-3">— {lt.label} →</span> {nameOf(lt.to_activity_type_id)}
                {lt.aggregate !== "none" && <span className="ml-2 rounded-full bg-line-soft px-2 py-0.5 text-[11px] text-ink-2">{AGGREGATE_LABEL[lt.aggregate]}</span>}
              </span>
              {isOwner && (
                <button type="button" onClick={() => archive(lt.id)} disabled={busy === lt.id} className="text-ink-3 hover:text-overdue">
                  {busy === lt.id ? "Archiving…" : "Archive"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isOwner && (
        adding ? (
          <LinkTypeForm types={types} onDone={() => { setAdding(false); router.refresh(); }} onCancel={() => setAdding(false)} />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="text-[13px] text-brand hover:underline">
            + Add a relationship
          </button>
        )
      )}
      {error && <p className="text-[12px] text-overdue">{error}</p>}
    </div>
  );
}

function LinkTypeForm({
  types,
  onDone,
  onCancel,
}: {
  types: ActivityTypeOption[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [fromId, setFromId] = useState(types[0]?.id ?? "");
  const [toId, setToId] = useState(types[0]?.id ?? "");
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [aggregate, setAggregate] = useState<LinkAggregate>("none");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch("/api/settings/activity-link-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from_activity_type_id: fromId, to_activity_type_id: toId, key, label, aggregate }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not save this relationship.");
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-2.5 rounded-md border border-line-soft bg-paper p-3">
      <div className="grid gap-2.5 min-[640px]:grid-cols-2">
        <div>
          <label htmlFor="fromType" className="mb-1 block text-[12px] font-medium text-ink">From</label>
          <select id="fromType" value={fromId} onChange={(e) => setFromId(e.target.value)} className={inputClass}>
            {types.map((t) => <option key={t.id} value={t.id}>{t.label_plural}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="toType" className="mb-1 block text-[12px] font-medium text-ink">Links to</label>
          <select id="toType" value={toId} onChange={(e) => setToId(e.target.value)} className={inputClass}>
            {types.map((t) => <option key={t.id} value={t.id}>{t.label_plural}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ltKey" className="mb-1 block text-[12px] font-medium text-ink">Key</label>
          <input id="ltKey" required value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} placeholder="e.g. references" className={`${inputClass} font-mono`} />
        </div>
        <div>
          <label htmlFor="ltLabel" className="mb-1 block text-[12px] font-medium text-ink">What it&apos;s called</label>
          <input id="ltLabel" required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. References" className={inputClass} />
        </div>
        <div className="min-[640px]:col-span-2">
          <label htmlFor="ltAggregate" className="mb-1 block text-[12px] font-medium text-ink">Rollup</label>
          <select id="ltAggregate" value={aggregate} onChange={(e) => setAggregate(e.target.value as LinkAggregate)} className={inputClass}>
            {LINK_AGGREGATES.map((a) => <option key={a} value={a}>{AGGREGATE_LABEL[a]}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="text-[12px] text-overdue">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className={buttonSecondaryClass}>{saving ? "Saving…" : "Save"}</button>
        <button type="button" onClick={onCancel} className="text-[12.5px] text-ink-2 hover:text-ink">Cancel</button>
      </div>
    </form>
  );
}
