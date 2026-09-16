"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, buttonPrimaryClass } from "@/lib/ui/styles";
import { computeAmount, PricingError } from "@/lib/pricing";
import { formatMoney, fromMinor, toMinor } from "@/lib/money";
import type { ActivityField } from "@/lib/activities/details-schema";

/**
 * The form that makes one codebase serve many industries: it has no fields of
 * its own. It reads the selected activity type's definitions and renders
 * whatever that business said it records — Origin and Destination for a
 * freight operator, Material grade and Weight for a scrap yard.
 *
 * Adding an industry adds rows to activity_fields. Nothing here changes.
 */
/** An existing activity, loaded into the form to be corrected. */
export interface EditableActivity {
  id: string;
  activity_type_id: string;
  party_id: string;
  bill_to_party_id: string | null;
  occurred_on: string;
  reference: string | null;
  amount_minor: number;
  status: "pending" | "completed" | "cancelled";
  details: Record<string, unknown>;
}

export interface ActivityTypeOption {
  id: string;
  label_singular: string;
  direction: "receivable" | "payable";
  pricing_strategy: "manual" | "flat" | "quantity_rate";
  pricing_config: Record<string, unknown>;
  activity_fields: ActivityField[];
}

export function ActivityForm({
  types,
  parties,
  currency,
  locale,
  editing,
  onDone,
}: {
  types: ActivityTypeOption[];
  parties: { id: string; name: string }[];
  currency: string;
  locale: string;
  /** Present when correcting an existing activity rather than recording one. */
  editing?: EditableActivity;
  onDone?: () => void;
}) {
  const router = useRouter();
  // The activity TYPE is fixed once recorded: `details` is validated against
  // that type's field schema and `direction` is pinned to it by a composite
  // foreign key, so changing it here would produce a row the database refuses.
  const [typeId, setTypeId] = useState(editing?.activity_type_id ?? types[0]?.id ?? "");
  const [partyId, setPartyId] = useState(editing?.party_id ?? "");
  const [billToPartyId, setBillToPartyId] = useState(editing?.bill_to_party_id ?? "");
  const [occurredOn, setOccurredOn] = useState(
    editing?.occurred_on ?? new Date().toISOString().slice(0, 10),
  );
  const [reference, setReference] = useState(editing?.reference ?? "");
  const [manualAmount, setManualAmount] = useState(
    editing ? String(fromMinor(editing.amount_minor, currency)) : "",
  );
  const [details, setDetails] = useState<Record<string, unknown>>(editing?.details ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const type = types.find((t) => t.id === typeId);
  const fields = useMemo(
    () => (type?.activity_fields ?? []).filter((f) => !f.archived_at).sort(sortByOrder),
    [type],
  );

  // A live preview of the amount, so the figure is never a surprise at save.
  const preview = useMemo(() => {
    if (!type) return null;
    try {
      const { amountMinor, explanation } = computeAmount({
        strategy: type.pricing_strategy,
        config: type.pricing_config,
        details,
        manualAmountMinor: manualAmount ? toMinor(Number(manualAmount), currency) : undefined,
      });
      return { text: formatMoney(amountMinor, currency, locale), explanation, error: null as string | null };
    } catch (err) {
      return { text: null, explanation: "", error: err instanceof PricingError ? err.message : "—" };
    }
  }, [type, details, manualAmount, currency, locale]);

  function setField(key: string, value: unknown) {
    setDetails((d) => ({ ...d, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    // A correction PATCHes the whole row; update_activity takes a full
    // replacement, so that a nullable field can be cleared as well as set.
    const res = await fetch(
      editing ? `/api/activities/${editing.id}` : "/api/activities",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editing ? {} : { activity_type_id: typeId }),
          party_id: partyId,
          // Empty means "the same party", which is the common case — a null
          // here is not missing data, it is the absence of a third party.
          bill_to_party_id: billToPartyId || null,
          occurred_on: occurredOn,
          reference: reference || null,
          details,
          amount_minor: manualAmount ? toMinor(Number(manualAmount), currency) : undefined,
          ...(editing ? { status: editing.status } : {}),
        }),
      },
    );
    const body = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(body.error ?? (editing ? "Could not save this correction." : "Could not record this."));
      return;
    }
    if (!editing) {
      setDetails({});
      setReference("");
      setManualAmount("");
      setBillToPartyId("");
    }
    onDone?.();
    router.refresh();
  }

  if (types.length === 0) {
    return (
      <p className="rounded-[10px] border border-line bg-white p-6 text-[13.5px] text-ink-3">
        No activity types set up yet. An owner defines what this business records before
        anything can be logged against it.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-line bg-white p-5">
      <div className="grid gap-3 min-[640px]:grid-cols-3">
        <Labelled label="What" htmlFor="type">
          <select
            id="type"
            value={typeId}
            disabled={Boolean(editing)}
            onChange={(e) => {
              setTypeId(e.target.value);
              setDetails({}); // a different type means a different shape
            }}
            className={inputClass}
          >
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label_singular} {t.direction === "payable" ? "(we pay)" : ""}
              </option>
            ))}
          </select>
        </Labelled>

        <Labelled label="Party" htmlFor="party">
          <select id="party" required value={partyId} onChange={(e) => setPartyId(e.target.value)} className={inputClass}>
            <option value="">Select…</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Labelled>

        {/* A load delivered to a consignee and invoiced to the broker who
            booked it. Left blank — the common case — the work is billed to
            the party it was done for. */}
        <Labelled label="Bill to (if different)" htmlFor="billTo">
          <select
            id="billTo"
            value={billToPartyId}
            onChange={(e) => setBillToPartyId(e.target.value)}
            className={inputClass}
          >
            <option value="">Same as party</option>
            {parties
              .filter((p) => p.id !== partyId)
              .map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
          </select>
        </Labelled>

        <Labelled label="Date" htmlFor="date">
          <input
            id="date" type="date" required value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </Labelled>
      </div>

      {/* Everything below is drawn from the type's own definitions. */}
      {fields.length > 0 && (
        <div className="grid gap-3 border-t border-line-soft pt-4 min-[640px]:grid-cols-2">
          {fields.map((field) => (
            <Labelled
              key={field.key}
              label={field.label + (field.is_required ? "" : " (optional)")}
              htmlFor={`f-${field.key}`}
            >
              <FieldInput field={field} value={details[field.key]} onChange={(v) => setField(field.key, v)} currency={currency} />
            </Labelled>
          ))}
        </div>
      )}

      <div className="grid gap-3 border-t border-line-soft pt-4 min-[640px]:grid-cols-2">
        <Labelled label="Reference (optional)" htmlFor="ref">
          <input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
        </Labelled>

        {type?.pricing_strategy === "manual" && (
          <Labelled label={`Amount (${currency})`} htmlFor="amount">
            <input
              id="amount" type="number" step="any" required value={manualAmount}
              onChange={(e) => setManualAmount(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          </Labelled>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4">
        <p className="text-[13.5px] text-ink-2">
          {preview?.text ? (
            <>
              Amount: <span className="font-mono font-medium text-ink">{preview.text}</span>
              {preview.explanation && <span className="text-ink-3"> · {preview.explanation}</span>}
            </>
          ) : (
            <span className="text-ink-3">{preview?.error}</span>
          )}
        </p>
        <button type="submit" disabled={saving} className={buttonPrimaryClass}>
          {saving ? "Saving…" : editing ? "Save correction" : "Record"}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="text-[13.5px] text-ink-2 hover:text-ink">
            Cancel
          </button>
        )}
      </div>

      {error && <p className="rounded-md bg-overdue-tint p-3 text-[13px] text-overdue">{error}</p>}
    </form>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  currency,
}: {
  field: ActivityField;
  value: unknown;
  onChange: (v: unknown) => void;
  currency: string;
}) {
  const id = `f-${field.key}`;

  switch (field.field_type) {
    case "number":
      return (
        <input
          id={id} type="number" step="any" required={field.is_required}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          className={`${inputClass} font-mono`}
        />
      );
    case "money":
      // An amount, typed the way a person says it — 22, not 2200. The
      // conversion to minor units happens once, on the server, using the
      // organisation's currency. See migration 0019 for why this is its own
      // type rather than a `number` with a note attached.
      return (
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">
            {currency}
          </span>
          <input
            id={id} type="number" step="0.01" min="0" required={field.is_required}
            value={value === undefined || value === null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
            className={`${inputClass} pl-11 text-right font-mono`}
          />
        </div>
      );
    case "boolean":
      return (
        <label className="flex h-[46px] items-center gap-2 text-[13.5px] text-ink-2">
          <input
            id={id} type="checkbox" checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="size-4 accent-brand"
          />
          Yes
        </label>
      );
    case "date":
      return (
        <input
          id={id} type="date" required={field.is_required}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          className={`${inputClass} font-mono`}
        />
      );
    case "select":
      return (
        <select
          id={id} required={field.is_required}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          className={inputClass}
        >
          <option value="">Select…</option>
          {field.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    case "long_text":
      return (
        <textarea
          id={id} rows={3} required={field.is_required}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          className={inputClass}
        />
      );
    default:
      return (
        <input
          id={id} required={field.is_required}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          className={inputClass}
        />
      );
  }
}

function Labelled({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-ink">{label}</label>
      {children}
    </div>
  );
}

function sortByOrder(a: ActivityField & { sort_order?: number }, b: ActivityField & { sort_order?: number }) {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0);
}
