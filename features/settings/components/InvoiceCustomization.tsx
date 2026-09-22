"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, buttonSecondaryClass } from "@/lib/ui/styles";

/**
 * What prints on this org's invoices, beyond which template renders them
 * (TemplatePicker). Two knobs, saved together as one call — see
 * set_org_invoice_customization() and its migration for why these two and
 * not an open column-builder.
 */
export function InvoiceCustomization({
  showHsn,
  terms,
  isOwner,
}: {
  showHsn: boolean;
  terms: string | null;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [show, setShow] = useState(showHsn);
  const [text, setText] = useState(terms ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    const res = await fetch("/api/settings/invoice-customization", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ show_hsn: show, terms: text || null }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not save your invoice settings.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  const dirty = show !== showHsn || text !== (terms ?? "");

  if (!isOwner) {
    return (
      <div>
        <p className="mb-1.5 text-[13px] font-medium text-ink">What prints on your invoice</p>
        <p className="text-[13px] text-ink-3">
          HSN/SAC is {showHsn ? "shown" : "hidden"}
          {terms ? " · terms & conditions are set" : ""}. Only an owner can change this.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-ink">What prints on your invoice</p>
      <p className="mb-3 text-[12.5px] text-ink-3">
        Read live, same as the logo and the template — changing this changes how every
        invoice reprints, past and future.
      </p>

      <label className="flex items-center gap-2 text-[13.5px] text-ink">
        <input
          type="checkbox"
          checked={show}
          onChange={(e) => setShow(e.target.checked)}
          className="size-4 rounded border-line"
        />
        Show HSN/SAC on line items that have one
      </label>

      <div className="mt-4">
        <label htmlFor="terms" className="mb-1.5 block text-[13px] font-medium text-ink">
          Terms &amp; Conditions <span className="font-normal text-ink-3">(optional)</span>
        </label>
        <textarea
          id="terms"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="e.g. Payment due within 30 days. Goods once sold will not be taken back."
          className={`${inputClass} resize-y`}
        />
        <p className="mt-1 text-[12px] text-ink-3">Printed on every invoice and bill, below the totals.</p>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className={buttonSecondaryClass}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && !dirty && <span className="text-[12.5px] text-settled-ink">Saved.</span>}
      </div>
      {error && <p className="mt-2 text-[12px] text-overdue">{error}</p>}
    </div>
  );
}
