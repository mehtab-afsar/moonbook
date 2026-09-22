"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, buttonSecondaryClass } from "@/lib/ui/styles";

export interface ComplianceRefs {
  ewb_no: string | null;
  ewb_valid_until: string | null;
  irn: string | null;
  irn_ack_no: string | null;
  irn_ack_date: string | null;
  qr_code_data: string | null;
  einvoice_status: "not_applicable" | "pending" | "generated" | "cancelled";
}

const STATUS_LABEL: Record<ComplianceRefs["einvoice_status"], string> = {
  not_applicable: "Not applicable",
  pending: "Pending generation",
  generated: "Generated",
  cancelled: "Cancelled",
};

/**
 * A place to record what was already generated on the government e-way
 * bill portal and Invoice Registration Portal — Moonbook has no API
 * integration with either, so this is entry, not automation. See
 * 20261001000007_document_compliance_refs.sql for the full reasoning.
 */
export function ComplianceRefsForm({
  documentId,
  refs,
  isOwner,
}: {
  documentId: string;
  refs: ComplianceRefs;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [ewbNo, setEwbNo] = useState(refs.ewb_no ?? "");
  const [irn, setIrn] = useState(refs.irn ?? "");
  const [ackNo, setAckNo] = useState(refs.irn_ack_no ?? "");
  const [ackDate, setAckDate] = useState(refs.irn_ack_date ?? "");
  const [status, setStatus] = useState(refs.einvoice_status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateNote, setGenerateNote] = useState("");

  const hasAny = refs.ewb_no || refs.irn || refs.einvoice_status !== "not_applicable";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch(`/api/documents/${documentId}/compliance`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ewb_no: ewbNo.trim() || null,
        irn: irn.trim() || null,
        irn_ack_no: ackNo.trim() || null,
        irn_ack_date: ackDate || null,
        einvoice_status: status,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not save these references.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  /** Always fails today — see app/api/documents/[id]/gstn/generate-irn's own
   *  comment. Wired up so the button has somewhere real to call the moment
   *  a GSP is actually connected, rather than being added later. */
  async function generateViaGstn() {
    setGenerating(true);
    setGenerateNote("");
    const res = await fetch(`/api/documents/${documentId}/gstn/generate-irn`, { method: "POST" });
    setGenerating(false);
    const body = await res.json().catch(() => ({}));
    setGenerateNote(body.error ?? "Could not generate this.");
  }

  if (!editing) {
    return (
      <section className="rounded-[10px] border border-line bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-medium text-ink-2">E-way bill &amp; e-invoice</h2>
          {isOwner && (
            <div className="flex items-center gap-3">
              <button type="button" onClick={generateViaGstn} disabled={generating} className="text-[13px] text-ink-2 hover:text-ink">
                {generating ? "Generating…" : "Generate via GSTN"}
              </button>
              <button type="button" onClick={() => setEditing(true)} className="text-[13px] text-brand hover:underline">
                {hasAny ? "Edit" : "Add"}
              </button>
            </div>
          )}
        </div>
        {generateNote && <p className="mt-2 text-[12px] text-ink-3">{generateNote}</p>}
        {hasAny ? (
          <dl className="mt-2 space-y-1 text-[13.5px]">
            {refs.ewb_no && (
              <div className="flex justify-between"><dt className="text-ink-2">E-way bill no.</dt><dd className="font-mono text-ink">{refs.ewb_no}</dd></div>
            )}
            {refs.irn && (
              <div className="flex justify-between gap-4"><dt className="shrink-0 text-ink-2">IRN</dt><dd className="truncate font-mono text-ink" title={refs.irn}>{refs.irn}</dd></div>
            )}
            {refs.irn_ack_no && (
              <div className="flex justify-between"><dt className="text-ink-2">Ack. no.</dt><dd className="font-mono text-ink">{refs.irn_ack_no}</dd></div>
            )}
            <div className="flex justify-between"><dt className="text-ink-2">E-invoice status</dt><dd className="text-ink">{STATUS_LABEL[refs.einvoice_status]}</dd></div>
          </dl>
        ) : (
          <p className="mt-1.5 text-[12.5px] text-ink-3">
            Nothing recorded — generate these on the government portals, then note them here so
            they print on this document.
          </p>
        )}
      </section>
    );
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-[10px] border border-line bg-white p-5">
      <h2 className="text-[13px] font-medium text-ink-2">E-way bill &amp; e-invoice</h2>
      <p className="text-[12.5px] text-ink-3">
        Entered by hand from the government portals — Moonbook doesn&apos;t call either API yet.
      </p>

      <div className="grid gap-3 min-[560px]:grid-cols-2">
        <Labelled label="E-way bill no. (12 digits, optional)" htmlFor="ewb">
          <input id="ewb" value={ewbNo} onChange={(e) => setEwbNo(e.target.value)} maxLength={12} className={`${inputClass} font-mono`} />
        </Labelled>
        <Labelled label="E-invoice status" htmlFor="status">
          <select id="status" value={status} onChange={(e) => setStatus(e.target.value as ComplianceRefs["einvoice_status"])} className={inputClass}>
            {(Object.keys(STATUS_LABEL) as ComplianceRefs["einvoice_status"][]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </Labelled>
        <Labelled label="IRN (64 hex characters, optional)" htmlFor="irn">
          <input id="irn" value={irn} onChange={(e) => setIrn(e.target.value)} maxLength={64} className={`${inputClass} font-mono`} />
        </Labelled>
        <Labelled label="Ack. no. (optional)" htmlFor="ackNo">
          <input id="ackNo" value={ackNo} onChange={(e) => setAckNo(e.target.value)} className={`${inputClass} font-mono`} />
        </Labelled>
        <Labelled label="Ack. date (optional)" htmlFor="ackDate">
          <input id="ackDate" type="date" value={ackDate} onChange={(e) => setAckDate(e.target.value)} className={`${inputClass} font-mono`} />
        </Labelled>
      </div>

      {error && <p className="rounded-md bg-overdue-tint p-3 text-[13px] text-overdue">{error}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className={buttonSecondaryClass}>{saving ? "Saving…" : "Save"}</button>
        <button type="button" onClick={() => setEditing(false)} className="text-[13px] text-ink-2 hover:text-ink">Cancel</button>
      </div>
    </form>
  );
}

function Labelled({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-ink">{label}</label>
      {children}
    </div>
  );
}
