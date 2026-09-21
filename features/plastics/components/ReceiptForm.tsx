"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, fromMinor, toMinor, type CurrencyCode } from "@/lib/money";
import { inputClass, buttonPrimaryClass } from "@/lib/ui/styles";

export interface OpenDocument {
  id: string; doc_no: string; doc_date: string; due_date: string | null; currency: string; balance_due_minor: number;
}

const COPY = {
  in: { who: "Who paid?", amount: "Amount received", when: "Received on", submit: "Record receipt" },
  out: { who: "Who did we pay?", amount: "Amount paid", when: "Paid on", submit: "Record payment" },
} as const;

export function ReceiptForm({
  parties, openByParty, locale, today, direction = "in", defaultCurrency,
}: {
  parties: { id: string; name: string }[]; openByParty: Record<string, OpenDocument[]>;
  locale: string; today: string; direction?: "in" | "out"; defaultCurrency: string;
}) {
  const copy = COPY[direction];
  const id = (base: string) => `pr${direction}-${base}`;
  const router = useRouter();
  const [partyId, setPartyId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState("bank");
  const [reference, setReference] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const open = useMemo(() => openByParty[partyId] ?? [], [openByParty, partyId]);
  const currency = (open[0]?.currency ?? defaultCurrency) as CurrencyCode;
  const amountMinor = useMemo(() => {
    if (!currency || !amount.trim()) return 0;
    try { return toMinor(Number(amount), currency); } catch { return 0; }
  }, [amount, currency]);

  const allocation = useMemo(() => {
    const rows: { id: string; minor: number }[] = [];
    let left = amountMinor;
    for (const doc of open) {
      const typed = overrides[doc.id];
      let minor: number;
      if (typed?.trim()) { try { minor = toMinor(Number(typed), currency); } catch { minor = 0; } }
      else { minor = Math.min(left, doc.balance_due_minor); }
      minor = Math.max(0, Math.min(minor, doc.balance_due_minor));
      if (minor > 0) rows.push({ id: doc.id, minor });
      left -= minor; if (left < 0) left = 0;
    }
    return rows;
  }, [amountMinor, open, overrides, currency]);

  const allocated = allocation.reduce((s, r) => s + r.minor, 0);
  const unapplied = amountMinor - allocated;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (amountMinor <= 0) { setError("Enter the amount."); return; }
    if (unapplied < 0) { setError("That allocates more than the amount."); return; }
    setSaving(true); setError("");
    const res = await fetch("/api/plastics/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        direction, party_id: partyId, amount_minor: amountMinor, paid_on: paidOn, method,
        reference_no: reference || null,
        allocations: allocation.map((r) => ({ document_id: r.id, amount_minor: r.minor })),
      }),
    });
    const body = await res.json();
    if (!res.ok) { setSaving(false); setError(body.error ?? "Something went wrong."); return; }
    setSaving(false); setAmount(""); setReference(""); setOverrides({}); setPartyId("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-line bg-white p-5">
      <div className="grid gap-4 min-[720px]:grid-cols-2">
        <div className="min-[720px]:col-span-2">
          <label htmlFor={id("party")} className="mb-1.5 block text-[13px] font-medium text-ink">{copy.who}</label>
          <select id={id("party")} required value={partyId} onChange={(e) => { setPartyId(e.target.value); setOverrides({}); }} className={inputClass}>
            <option value="">Choose a party…</option>
            {parties.map((p) => {
              const n = openByParty[p.id]?.length ?? 0;
              return <option key={p.id} value={p.id}>{p.name}{n > 0 ? ` — ${n} open` : ""}</option>;
            })}
          </select>
        </div>
        <div>
          <label htmlFor={id("amount")} className="mb-1.5 block text-[13px] font-medium text-ink">{copy.amount}</label>
          <input id={id("amount")} type="number" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputClass} font-mono`} />
        </div>
        <div>
          <label htmlFor={id("paidon")} className="mb-1.5 block text-[13px] font-medium text-ink">{copy.when}</label>
          <input id={id("paidon")} type="date" required value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor={id("method")} className="mb-1.5 block text-[13px] font-medium text-ink">How</label>
          <select id={id("method")} value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            <option value="bank">Bank transfer</option><option value="cash">Cash</option>
            <option value="cheque">Cheque</option><option value="card">Card</option><option value="online">Online</option>
          </select>
        </div>
        <div>
          <label htmlFor={id("ref")} className="mb-1.5 block text-[13px] font-medium text-ink">Reference (optional)</label>
          <input id={id("ref")} value={reference} onChange={(e) => setReference(e.target.value)} className={`${inputClass} font-mono`} />
        </div>
      </div>

      {partyId !== "" && open.length > 0 && amountMinor > 0 && (
        <div className="space-y-2">
          <span className="block text-[13px] font-medium text-ink">What does this settle?</span>
          <div className="divide-y divide-line-soft rounded-md border border-line">
            {open.map((doc) => {
              const row = allocation.find((r) => r.id === doc.id);
              return (
                <div key={doc.id} className="flex items-center gap-4 p-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[13.5px] text-ink">{doc.doc_no}</span>
                    <span className="block text-[12.5px] text-ink-3">{doc.doc_date} · outstanding {formatMoney(doc.balance_due_minor, doc.currency, locale)}</span>
                  </span>
                  <span className="w-[150px] shrink-0">
                    <input type="number" step="0.01" min="0" max={fromMinor(doc.balance_due_minor, doc.currency as CurrencyCode)}
                      aria-label={`Allocate to ${doc.doc_no}`}
                      value={overrides[doc.id] ?? (row ? String(fromMinor(row.minor, doc.currency as CurrencyCode)) : "")}
                      onChange={(e) => setOverrides((prev) => ({ ...prev, [doc.id]: e.target.value }))}
                      className={`${inputClass} text-right font-mono`} />
                  </span>
                </div>
              );
            })}
          </div>
          {unapplied !== 0 && (
            <p className={`text-[12.5px] ${unapplied < 0 ? "text-overdue" : "text-ink-2"}`}>
              {unapplied > 0 ? `${formatMoney(unapplied, currency, locale)} will be left unapplied.` : `That allocates ${formatMoney(-unapplied, currency, locale)} more than was recorded.`}
            </p>
          )}
        </div>
      )}

      {error && <p className="rounded-md bg-overdue-tint p-3 text-[13px] text-overdue">{error}</p>}
      <button type="submit" disabled={saving || partyId === ""} className={buttonPrimaryClass}>{saving ? "Recording…" : copy.submit}</button>
    </form>
  );
}
