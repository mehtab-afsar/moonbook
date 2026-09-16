"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { fromMinor, toMinor, type CurrencyCode } from "@/lib/money";
import { inputClass, buttonPrimaryClass } from "@/lib/ui/styles";

/**
 * Take money against one document.
 *
 * The amount defaults to the balance and is capped at it in the UI, but the
 * cap that matters is the one in `allocate()`, which locks the document and
 * refuses to exceed its balance. This is a convenience; that is the rule.
 */
export function RecordPaymentForm({
  documentId,
  partyId,
  balanceMinor,
  currency,
  locale,
  today,
}: {
  documentId: string;
  partyId: string;
  balanceMinor: number;
  currency: string;
  locale: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(fromMinor(balanceMinor, currency as CurrencyCode)));
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState("bank");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    let amountMinor: number;
    try {
      amountMinor = toMinor(Number(amount), currency as CurrencyCode);
    } catch {
      setSaving(false);
      setError("That amount isn't a number we can record.");
      return;
    }

    const res = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        direction: "in",
        party_id: partyId,
        amount_minor: amountMinor,
        paid_on: paidOn,
        method,
        reference_no: reference || null,
        allocations: [{ document_id: documentId, amount_minor: amountMinor }],
      }),
    });
    const body = await res.json();

    if (!res.ok) {
      setSaving(false);
      setError(body.error ?? "Something went wrong. Please try again.");
      return;
    }
    setOpen(false);
    setSaving(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonPrimaryClass}>
        Record a payment
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-line bg-white p-5">
      <p className="text-[13.5px] text-ink-2">
        Outstanding on this invoice: <span className="font-mono text-ink">{formatMoney(balanceMinor, currency, locale)}</span>
      </p>

      <div className="grid gap-4 min-[560px]:grid-cols-2">
        <div>
          <label htmlFor="amount" className="mb-1.5 block text-[13px] font-medium text-ink">
            Amount received
          </label>
          <input
            id="amount" type="number" step="0.01" min="0.01" required
            max={fromMinor(balanceMinor, currency as CurrencyCode)}
            value={amount} onChange={(e) => setAmount(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </div>
        <div>
          <label htmlFor="paidOn" className="mb-1.5 block text-[13px] font-medium text-ink">
            Received on
          </label>
          <input
            id="paidOn" type="date" required value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)} className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="method" className="mb-1.5 block text-[13px] font-medium text-ink">
            How
          </label>
          <select id="method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            <option value="bank">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="cheque">Cheque</option>
            <option value="card">Card</option>
            <option value="online">Online</option>
          </select>
        </div>
        <div>
          <label htmlFor="reference" className="mb-1.5 block text-[13px] font-medium text-ink">
            Reference <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <input
            id="reference" value={reference} onChange={(e) => setReference(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </div>
      </div>

      {error && <p className="rounded-md bg-overdue-tint p-3 text-[13px] text-overdue">{error}</p>}

      <div className="flex gap-3">
        <button type="submit" disabled={saving} className={buttonPrimaryClass}>
          {saving ? "Recording…" : "Record it"}
        </button>
        <button
          type="button" onClick={() => { setOpen(false); setError(""); }}
          className="text-[13.5px] text-ink-2 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
