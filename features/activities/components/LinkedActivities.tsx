"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { inputClass, buttonSecondaryClass } from "@/lib/ui/styles";

export interface LinkedActivityRow {
  linkId: string;
  activityId: string;
  label: string; // the other activity's type label + reference/date
  amountMinor: number;
  currency: string;
}

export interface AvailableLinkType {
  id: string;
  label: string;
  aggregate: "none" | "sum_amount" | "count";
  /** Candidates this activity could link to — this org's own activities of
   *  the link type's declared target type, fetched server-side so the form
   *  never has to guess what's eligible. */
  candidates: { id: string; label: string }[];
}

/**
 * What this activity links to, grouped by relationship, with the rollup
 * (sum/count — never a formula, see 20261001000010_activity_link_types.sql)
 * shown when the relationship declares one.
 */
export function LinkedActivities({
  activityId,
  locale,
  groups,
  availableLinkTypes,
}: {
  activityId: string;
  locale: string;
  groups: { linkTypeLabel: string; aggregate: "none" | "sum_amount" | "count"; rows: LinkedActivityRow[] }[];
  availableLinkTypes: AvailableLinkType[];
}) {
  const router = useRouter();
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function unlink(linkId: string) {
    setBusy(linkId);
    setError("");
    const res = await fetch(`/api/activities/links/${linkId}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not remove this link.");
      return;
    }
    router.refresh();
  }

  if (groups.length === 0 && availableLinkTypes.length === 0) return null;

  return (
    <section className="rounded-[10px] border border-line bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-medium text-ink-2">Linked activities</h2>
        {availableLinkTypes.length > 0 && !linking && (
          <button type="button" onClick={() => setLinking(true)} className="text-[13px] text-brand hover:underline">
            + Link an activity
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">Nothing linked yet.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {groups.map((g) => {
            const rollup =
              g.aggregate === "sum_amount"
                ? formatMoney(g.rows.reduce((s, r) => s + r.amountMinor, 0), g.rows[0]?.currency ?? "USD", locale)
                : g.aggregate === "count"
                  ? String(g.rows.length)
                  : null;
            return (
              <div key={g.linkTypeLabel}>
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[12.5px] font-medium text-ink-2">{g.linkTypeLabel}</h3>
                  {rollup !== null && (
                    <span className="font-mono text-[12.5px] text-ink">
                      {g.aggregate === "sum_amount" ? "Total " : "Count "}{rollup}
                    </span>
                  )}
                </div>
                <ul className="mt-1.5 divide-y divide-line-soft rounded-md border border-line-soft">
                  {g.rows.map((r) => (
                    <li key={r.linkId} className="flex items-center justify-between px-3 py-2 text-[13px]">
                      <Link href={`/activities/${r.activityId}`} className="text-brand hover:underline">{r.label}</Link>
                      <span className="flex items-center gap-3">
                        <span className="font-mono text-ink-2">{formatMoney(r.amountMinor, r.currency, locale)}</span>
                        <button type="button" onClick={() => unlink(r.linkId)} disabled={busy === r.linkId} className="text-ink-3 hover:text-overdue">
                          {busy === r.linkId ? "…" : "Unlink"}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {linking && (
        <LinkForm
          activityId={activityId}
          availableLinkTypes={availableLinkTypes}
          onDone={() => { setLinking(false); router.refresh(); }}
          onCancel={() => setLinking(false)}
        />
      )}
      {error && <p className="mt-2 text-[12px] text-overdue">{error}</p>}
    </section>
  );
}

function LinkForm({
  activityId,
  availableLinkTypes,
  onDone,
  onCancel,
}: {
  activityId: string;
  availableLinkTypes: AvailableLinkType[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [linkTypeId, setLinkTypeId] = useState(availableLinkTypes[0]?.id ?? "");
  const candidates = availableLinkTypes.find((lt) => lt.id === linkTypeId)?.candidates ?? [];
  const [targetId, setTargetId] = useState(candidates[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetId) { setError("Nothing eligible to link to yet."); return; }
    setSaving(true);
    setError("");
    const res = await fetch("/api/activities/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link_type_id: linkTypeId, from_activity_id: activityId, to_activity_id: targetId }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not create this link.");
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2.5 rounded-md border border-line-soft bg-paper p-3">
      <div className="grid gap-2.5 min-[560px]:grid-cols-2">
        <div>
          <label htmlFor="linkType" className="mb-1 block text-[12px] font-medium text-ink">Relationship</label>
          <select
            id="linkType" value={linkTypeId}
            onChange={(e) => { setLinkTypeId(e.target.value); setTargetId(""); }}
            className={inputClass}
          >
            {availableLinkTypes.map((lt) => <option key={lt.id} value={lt.id}>{lt.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="target" className="mb-1 block text-[12px] font-medium text-ink">Links to</label>
          <select id="target" value={targetId} onChange={(e) => setTargetId(e.target.value)} className={inputClass}>
            <option value="">Select…</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="text-[12px] text-overdue">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className={buttonSecondaryClass}>{saving ? "Linking…" : "Link"}</button>
        <button type="button" onClick={onCancel} className="text-[12.5px] text-ink-2 hover:text-ink">Cancel</button>
      </div>
    </form>
  );
}
