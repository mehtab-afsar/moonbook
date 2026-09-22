"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, buttonSecondaryClass, buttonPrimaryClass } from "@/lib/ui/styles";
import { DIRECTIONS, PRICING_STRATEGIES, type Direction, type PricingStrategyName } from "@/lib/domain";

const DIRECTION_LABEL: Record<Direction, string> = { receivable: "Bills a client", payable: "Owed to a vendor" };
const PRICING_LABEL: Record<PricingStrategyName, string> = {
  manual: "Typed in by hand", flat: "Fixed amount", quantity_rate: "Quantity × rate",
};

export interface ActivityTypeSummary {
  id: string;
  label_singular: string;
  label_plural: string;
  direction: Direction;
  pricing_strategy: PricingStrategyName;
  uses_period: boolean;
  uses_job_margin: boolean;
}

/** Owner-only Edit/Archive controls for one existing activity type, and the
 *  inline edit form — key/direction are fixed at creation, everything else
 *  is presentation and safe to change. See
 *  20261001000011_self_serve_activity_types.sql for the identity split. */
export function ActivityTypeHeader({ type, isOwner }: { type: ActivityTypeSummary; isOwner: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [labelSingular, setLabelSingular] = useState(type.label_singular);
  const [labelPlural, setLabelPlural] = useState(type.label_plural);
  const [pricingStrategy, setPricingStrategy] = useState(type.pricing_strategy);
  const [usesPeriod, setUsesPeriod] = useState(type.uses_period);
  const [usesJobMargin, setUsesJobMargin] = useState(type.uses_job_margin);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch(`/api/settings/activity-types/${type.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label_singular: labelSingular, label_plural: labelPlural,
        pricing_strategy: pricingStrategy, uses_period: usesPeriod, uses_job_margin: usesJobMargin,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not save this.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function archive() {
    if (!confirm(`Archive "${type.label_plural}"? It stops appearing for new work, but nothing already recorded changes.`)) return;
    setError("");
    const res = await fetch(`/api/settings/activity-types/${type.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not archive this.");
      return;
    }
    router.refresh();
  }

  if (editing) {
    return (
      <form onSubmit={save} className="space-y-2.5 rounded-md border border-line-soft bg-paper p-3">
        <div className="grid gap-2.5 min-[560px]:grid-cols-2">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-ink">Singular</label>
            <input required value={labelSingular} onChange={(e) => setLabelSingular(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-ink">Plural</label>
            <input required value={labelPlural} onChange={(e) => setLabelPlural(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-ink">Pricing</label>
            <select value={pricingStrategy} onChange={(e) => setPricingStrategy(e.target.value as PricingStrategyName)} className={inputClass}>
              {PRICING_STRATEGIES.map((p) => <option key={p} value={p}>{PRICING_LABEL[p]}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-[12.5px] text-ink">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={usesPeriod} onChange={(e) => setUsesPeriod(e.target.checked)} className="size-3.5 rounded border-line" />
            Has a start/end period
          </label>
          {type.direction === "receivable" && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={usesJobMargin} onChange={(e) => setUsesJobMargin(e.target.checked)} className="size-3.5 rounded border-line" />
              Track margin per job
            </label>
          )}
        </div>
        {error && <p className="text-[12px] text-overdue">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className={buttonSecondaryClass}>{saving ? "Saving…" : "Save"}</button>
          <button type="button" onClick={() => setEditing(false)} className="text-[12.5px] text-ink-2 hover:text-ink">Cancel</button>
        </div>
      </form>
    );
  }

  return isOwner ? (
    <span className="flex items-center gap-2.5 text-[13px]">
      <button type="button" onClick={() => setEditing(true)} className="text-brand hover:underline">Edit</button>
      <button type="button" onClick={archive} className="text-ink-3 hover:text-overdue">Archive</button>
      {error && <span className="text-overdue">{error}</span>}
    </span>
  ) : null;
}

/** "+ Add an activity type" — a brand-new type, not a field on an existing
 *  one. Direction and key are fixed forever once saved. */
export function AddActivityTypeForm({ isOwner }: { isOwner: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [labelSingular, setLabelSingular] = useState("");
  const [labelPlural, setLabelPlural] = useState("");
  const [direction, setDirection] = useState<Direction>("receivable");
  const [pricingStrategy, setPricingStrategy] = useState<PricingStrategyName>("manual");
  const [usesPeriod, setUsesPeriod] = useState(false);
  const [usesJobMargin, setUsesJobMargin] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!isOwner) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch("/api/settings/activity-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key, label_singular: labelSingular, label_plural: labelPlural, direction,
        pricing_strategy: pricingStrategy, uses_period: usesPeriod, uses_job_margin: usesJobMargin,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not add this activity type.");
      return;
    }
    setAdding(false);
    setKey(""); setLabelSingular(""); setLabelPlural("");
    router.refresh();
  }

  if (!adding) {
    return (
      <button type="button" onClick={() => setAdding(true)} className={buttonSecondaryClass}>
        + Add an activity type
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2.5 rounded-[10px] border border-line bg-white p-5">
      <div className="grid gap-2.5 min-[640px]:grid-cols-2">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink">Key <span className="font-normal text-ink-3">(fixed once saved)</span></label>
          <input required value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} placeholder="e.g. rental" className={`${inputClass} font-mono`} />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink">
            Direction <span className="font-normal text-ink-3">(fixed once saved)</span>
          </label>
          <select value={direction} onChange={(e) => setDirection(e.target.value as Direction)} className={inputClass}>
            {DIRECTIONS.map((d) => <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink">Singular</label>
          <input required value={labelSingular} onChange={(e) => setLabelSingular(e.target.value)} placeholder="e.g. Rental" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-ink">Plural</label>
          <input required value={labelPlural} onChange={(e) => setLabelPlural(e.target.value)} placeholder="e.g. Rentals" className={inputClass} />
        </div>
        <div className="min-[640px]:col-span-2">
          <label className="mb-1 block text-[12px] font-medium text-ink">Pricing</label>
          <select value={pricingStrategy} onChange={(e) => setPricingStrategy(e.target.value as PricingStrategyName)} className={inputClass}>
            {PRICING_STRATEGIES.map((p) => <option key={p} value={p}>{PRICING_LABEL[p]}</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-[12.5px] text-ink">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={usesPeriod} onChange={(e) => setUsesPeriod(e.target.checked)} className="size-3.5 rounded border-line" />
          Has a start/end period
        </label>
        {direction === "receivable" && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={usesJobMargin} onChange={(e) => setUsesJobMargin(e.target.checked)} className="size-3.5 rounded border-line" />
            Track margin per job
          </label>
        )}
      </div>
      {error && <p className="text-[12px] text-overdue">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className={buttonPrimaryClass}>{saving ? "Adding…" : "Add"}</button>
        <button type="button" onClick={() => setAdding(false)} className="text-[13px] text-ink-2 hover:text-ink">Cancel</button>
      </div>
    </form>
  );
}
