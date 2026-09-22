"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, buttonSecondaryClass } from "@/lib/ui/styles";
import { FIELD_TYPES, type FieldType } from "@/lib/domain";

const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: "Text", long_text: "Long text", number: "Number", money: "Money",
  date: "Date", select: "Choose one", boolean: "Yes/No",
};

export interface ActivityFieldRow {
  id: string;
  key: string;
  label: string;
  field_type: FieldType;
  options: string[];
  is_required: boolean;
  is_reportable: boolean;
  show_on_document: boolean;
}

/**
 * Fields on one of this org's own copied activity types — key and type are
 * fixed once added (see the migration's own reasoning); everything else can
 * be changed, and a field can be archived but never deleted, so a document
 * issued while it existed can still render the label it was captured under.
 */
export function ActivityFieldsEditor({
  activityTypeId,
  fields,
  isOwner,
}: {
  activityTypeId: string;
  fields: ActivityFieldRow[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function archive(id: string) {
    if (!confirm("Archive this field? It stays on any document already issued, but stops appearing on new ones.")) return;
    setBusy(id);
    setError("");
    const res = await fetch(`/api/settings/activity-fields/${id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not archive this field.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-2">
      {fields.length === 0 ? (
        <p className="text-[13px] text-ink-3">No extra fields — just an amount.</p>
      ) : (
        <ul className="space-y-1.5">
          {fields.map((f) =>
            editingId === f.id ? (
              <FieldForm
                key={f.id}
                mode="edit"
                activityTypeId={activityTypeId}
                field={f}
                onDone={() => { setEditingId(null); router.refresh(); }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <li key={f.id} className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="text-ink">{f.label}</span>
                  <span className="font-mono text-[12px] text-ink-3">{FIELD_TYPE_LABEL[f.field_type]}</span>
                  {f.is_required && <Tag>required</Tag>}
                  {f.is_reportable && <Tag>grouped in reports</Tag>}
                  {!f.show_on_document && <Tag>not printed</Tag>}
                </span>
                {isOwner && (
                  <span className="flex items-center gap-2.5">
                    <button type="button" onClick={() => setEditingId(f.id)} className="text-brand hover:underline">Edit</button>
                    <button type="button" onClick={() => archive(f.id)} disabled={busy === f.id} className="text-ink-3 hover:text-overdue">
                      {busy === f.id ? "Archiving…" : "Archive"}
                    </button>
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {isOwner && (
        adding ? (
          <FieldForm
            mode="add"
            activityTypeId={activityTypeId}
            onDone={() => { setAdding(false); router.refresh(); }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="text-[13px] text-brand hover:underline">
            + Add a field
          </button>
        )
      )}
      {error && <p className="text-[12px] text-overdue">{error}</p>}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-line-soft px-2 py-0.5 text-[11px] text-ink-2">{children}</span>;
}

function FieldForm({
  mode,
  activityTypeId,
  field,
  onDone,
  onCancel,
}: {
  mode: "add" | "edit";
  activityTypeId: string;
  field?: ActivityFieldRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState(field?.key ?? "");
  const [label, setLabel] = useState(field?.label ?? "");
  const [fieldType, setFieldType] = useState<FieldType>(field?.field_type ?? "text");
  const [optionsText, setOptionsText] = useState((field?.options ?? []).join(", "));
  const [isRequired, setIsRequired] = useState(field?.is_required ?? false);
  const [isReportable, setIsReportable] = useState(field?.is_reportable ?? false);
  const [showOnDocument, setShowOnDocument] = useState(field?.show_on_document ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const options = optionsText.split(",").map((o) => o.trim()).filter(Boolean);
    const body =
      mode === "add"
        ? { activity_type_id: activityTypeId, key, label, field_type: fieldType, options, is_required: isRequired, is_reportable: isReportable, show_on_document: showOnDocument }
        : { label, options, is_required: isRequired, is_reportable: isReportable, show_on_document: showOnDocument };

    const res = await fetch(
      mode === "add" ? "/api/settings/activity-fields" : `/api/settings/activity-fields/${field?.id}`,
      { method: mode === "add" ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    setSaving(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? "Could not save this field.");
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-2.5 rounded-md border border-line-soft bg-paper p-3">
      <div className="grid gap-2.5 min-[560px]:grid-cols-2">
        <div>
          <label htmlFor={`label-${field?.id ?? "new"}`} className="mb-1 block text-[12px] font-medium text-ink">Label</label>
          <input id={`label-${field?.id ?? "new"}`} required value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
        </div>
        {mode === "add" ? (
          <div>
            <label htmlFor="key" className="mb-1 block text-[12px] font-medium text-ink">
              Key <span className="font-normal text-ink-3">(lowercase, no spaces — fixed once saved)</span>
            </label>
            <input id="key" required value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} placeholder="e.g. batch_no" className={`${inputClass} font-mono`} />
          </div>
        ) : (
          <div>
            <span className="mb-1 block text-[12px] font-medium text-ink">Key / type</span>
            <p className="pt-1.5 font-mono text-[12.5px] text-ink-3">{field?.key} · {FIELD_TYPE_LABEL[fieldType]}</p>
          </div>
        )}
      </div>

      {mode === "add" && (
        <div>
          <label htmlFor="fieldType" className="mb-1 block text-[12px] font-medium text-ink">Type</label>
          <select id="fieldType" value={fieldType} onChange={(e) => setFieldType(e.target.value as FieldType)} className={inputClass}>
            {FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}
          </select>
        </div>
      )}

      {fieldType === "select" && (
        <div>
          <label htmlFor="options" className="mb-1 block text-[12px] font-medium text-ink">Options, comma-separated</label>
          <input id="options" required value={optionsText} onChange={(e) => setOptionsText(e.target.value)} placeholder="e.g. A, B, C" className={inputClass} />
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-[12.5px] text-ink">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} className="size-3.5 rounded border-line" />
          Required
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={isReportable} onChange={(e) => setIsReportable(e.target.checked)} className="size-3.5 rounded border-line" />
          Grouped in reports
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showOnDocument} onChange={(e) => setShowOnDocument(e.target.checked)} className="size-3.5 rounded border-line" />
          Printed on the invoice
        </label>
      </div>

      {error && <p className="text-[12px] text-overdue">{error}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className={buttonSecondaryClass}>{saving ? "Saving…" : "Save"}</button>
        <button type="button" onClick={onCancel} className="text-[12.5px] text-ink-2 hover:text-ink">Cancel</button>
      </div>
    </form>
  );
}
