"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, fromMinor, toMinor, type CurrencyCode } from "@/lib/money";
import { inputClass, buttonPrimaryClass } from "@/lib/ui/styles";
import { filterPartiesForKind, type PartyRole } from "@/lib/parties/roles";
import type { OpenDocument } from "./ReceiptForm";

export interface VendorService {
  id: string;
  label: string;
  occurred_on: string;
}

/**
 * Pay a vendor in one place: either against a bill you've already recorded,
 * or against a fresh charge that's never been logged anywhere — the vendor's
 * own invoice, typed in right here, rather than requiring a trip to Services
 * first to pre-log it as an activity. The two are mutually exclusive within
 * one submission: entering a new charge bills and pays it (up to the amount
 * you're paying now, which can be less — a 50/50 split leaves the rest open
 * to pay later from "already-open bills"); leaving it blank allocates the
 * amount against an already-open bill the ordinary way.
 *
 * "Which service was this for?" is a pure convenience note for your own
 * records — it has no effect on the bill or the invoice already sent to the
 * client.
 */
export function VendorPaymentForm({
  parties,
  servicesByVendor,
  openBillsByParty,
  locale,
  today,
  defaultCurrency,
  onDone,
}: {
  parties: { id: string; name: string; role?: PartyRole; kind?: "client" | "vendor" | null }[];
  servicesByVendor: Record<string, VendorService[]>;
  openBillsByParty: Record<string, OpenDocument[]>;
  locale: string;
  today: string;
  defaultCurrency: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [partyId, setPartyId] = useState("");
  const [hasNewCharge, setHasNewCharge] = useState(false);
  const [chargeAmount, setChargeAmount] = useState("");
  const [partyDocNo, setPartyDocNo] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState("bank");
  const [reference, setReference] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const vendorParties = useMemo(() => filterPartiesForKind(parties, "vendor"), [parties]);
  const services = servicesByVendor[partyId] ?? [];
  const openBills = useMemo(() => openBillsByParty[partyId] ?? [], [openBillsByParty, partyId]);

  const currency = (openBills[0]?.currency ?? defaultCurrency) as CurrencyCode;
  const amountMinor = useMemo(() => {
    if (!currency || !amount.trim()) return 0;
    try {
      return toMinor(Number(amount), currency);
    } catch {
      return 0;
    }
  }, [amount, currency]);
  const chargeAmountMinor = useMemo(() => {
    if (!currency || !chargeAmount.trim()) return 0;
    try {
      return toMinor(Number(chargeAmount), currency);
    } catch {
      return 0;
    }
  }, [chargeAmount, currency]);

  const allocation = useMemo(() => {
    if (hasNewCharge) return [];
    const rows: { id: string; minor: number }[] = [];
    let left = amountMinor;
    for (const doc of openBills) {
      const typed = overrides[doc.id];
      let minor: number;
      if (typed?.trim()) {
        try {
          minor = toMinor(Number(typed), currency);
        } catch {
          minor = 0;
        }
      } else {
        minor = Math.min(left, doc.balance_due_minor);
      }
      minor = Math.max(0, Math.min(minor, doc.balance_due_minor));
      if (minor > 0) rows.push({ id: doc.id, minor });
      left -= minor;
      if (left < 0) left = 0;
    }
    return rows;
  }, [amountMinor, openBills, overrides, currency, hasNewCharge]);

  const allocated = allocation.reduce((s, r) => s + r.minor, 0);
  const unapplied = amountMinor - allocated;

  function resetAfterSubmit() {
    setAmount("");
    setReference("");
    setOverrides({});
    setHasNewCharge(false);
    setChargeAmount("");
    setPartyDocNo("");
    setServiceId("");
    setPartyId("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (amountMinor <= 0) {
      setError("Enter the amount paid.");
      return;
    }
    if (!hasNewCharge && unapplied < 0) {
      setError("That allocates more than the amount paid.");
      return;
    }
    if (hasNewCharge && chargeAmountMinor <= 0) {
      setError("Enter the vendor's charge amount.");
      return;
    }
    if (hasNewCharge && !partyDocNo.trim()) {
      setError("Enter the vendor's own invoice or reference number.");
      return;
    }
    setSaving(true);
    setError("");

    let allocations = allocation.map((r) => ({ document_id: r.id, amount_minor: r.minor }));

    if (hasNewCharge) {
      const service = services.find((s) => s.id === serviceId);
      const activityRes = await fetch("/api/logistics/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: "payable",
          party_id: partyId,
          occurred_on: paidOn,
          amount_minor: chargeAmountMinor,
          vendor_ref: partyDocNo.trim(),
          reference: service ? `${service.label} · ${service.occurred_on}` : null,
        }),
      });
      const activityBody = await activityRes.json();
      if (!activityRes.ok) {
        setSaving(false);
        setError(activityBody.error ?? "Could not record this charge.");
        return;
      }

      const billRes = await fetch("/api/logistics/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_kind: "bill",
          counterparty_id: partyId,
          doc_date: paidOn,
          activity_ids: [activityBody.data.activity_id as string],
          party_doc_no: partyDocNo.trim(),
        }),
      });
      const billBody = await billRes.json();
      if (!billRes.ok) {
        setSaving(false);
        setError(`The charge was recorded, but the bill failed: ${billBody.error ?? "please try again."}`);
        router.refresh();
        return;
      }
      const billTotal = billBody.data.total_minor as number;
      allocations = [{ document_id: billBody.data.document_id as string, amount_minor: Math.min(amountMinor, billTotal) }];
    }

    const payRes = await fetch("/api/logistics/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        direction: "out",
        party_id: partyId,
        amount_minor: amountMinor,
        paid_on: paidOn,
        method,
        reference_no: reference || null,
        allocations,
      }),
    });
    const payBody = await payRes.json();
    if (!payRes.ok) {
      setSaving(false);
      setError(
        hasNewCharge
          ? `The bill was recorded, but the payment failed: ${payBody.error ?? "please try again."}`
          : (payBody.error ?? "Something went wrong."),
      );
      router.refresh();
      return;
    }

    setSaving(false);
    resetAfterSubmit();
    onDone?.();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-line bg-white p-5">
      <div className="grid gap-4 min-[720px]:grid-cols-2">
        <div className="min-[720px]:col-span-2">
          <label htmlFor="vp-party" className="mb-1.5 block text-[13px] font-medium text-ink">
            Who did we pay?
          </label>
          <select
            id="vp-party"
            required
            value={partyId}
            onChange={(e) => {
              setPartyId(e.target.value);
              setOverrides({});
              setHasNewCharge(false);
              setChargeAmount("");
              setPartyDocNo("");
              setServiceId("");
            }}
            className={inputClass}
          >
            <option value="">Choose a vendor…</option>
            {vendorParties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="vp-amount" className="mb-1.5 block text-[13px] font-medium text-ink">
            Amount paid now
          </label>
          <input
            id="vp-amount" type="number" step="0.01" min="0.01" required value={amount}
            onChange={(e) => setAmount(e.target.value)} className={`${inputClass} font-mono`}
          />
        </div>

        <div>
          <label htmlFor="vp-paidon" className="mb-1.5 block text-[13px] font-medium text-ink">
            Paid on
          </label>
          <input
            id="vp-paidon" type="date" required value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)} className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="vp-method" className="mb-1.5 block text-[13px] font-medium text-ink">
            How
          </label>
          <select id="vp-method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            <option value="bank">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="cheque">Cheque</option>
            <option value="card">Card</option>
            <option value="online">Online</option>
          </select>
        </div>

        <div>
          <label htmlFor="vp-ref" className="mb-1.5 block text-[13px] font-medium text-ink">
            Reference <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <input
            id="vp-ref" value={reference} onChange={(e) => setReference(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </div>
      </div>

      {partyId !== "" && (
        <div className="space-y-3 border-t border-line-soft pt-4">
          {hasNewCharge ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-ink">New charge from this vendor</span>
                <button
                  type="button"
                  onClick={() => { setHasNewCharge(false); setChargeAmount(""); setPartyDocNo(""); setServiceId(""); }}
                  className="text-[12.5px] text-ink-2 hover:text-ink"
                >
                  Cancel — pay an open bill instead
                </button>
              </div>
              <div className="grid gap-3 min-[640px]:grid-cols-2">
                <div>
                  <label htmlFor="vp-chargeamt" className="mb-1.5 block text-[13px] font-medium text-ink">
                    Vendor&apos;s charge amount
                  </label>
                  <input
                    id="vp-chargeamt" type="number" step="0.01" min="0.01" required value={chargeAmount}
                    onChange={(e) => setChargeAmount(e.target.value)} className={`${inputClass} font-mono`}
                  />
                </div>
                <div>
                  <label htmlFor="vp-partydocno" className="mb-1.5 block text-[13px] font-medium text-ink">
                    Vendor&apos;s invoice / reference number
                  </label>
                  <input
                    id="vp-partydocno" required value={partyDocNo}
                    onChange={(e) => setPartyDocNo(e.target.value)} className={`${inputClass} font-mono`}
                  />
                </div>
                {services.length > 0 && (
                  <div className="min-[640px]:col-span-2">
                    <label htmlFor="vp-service" className="mb-1.5 block text-[13px] font-medium text-ink">
                      Which service was this for? <span className="font-normal text-ink-3">(optional note, not printed anywhere)</span>
                    </label>
                    <select id="vp-service" value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={inputClass}>
                      <option value="">Not linked to a specific service</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>{s.label} · {s.occurred_on}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <p className="text-[12.5px] text-ink-3">
                {amountMinor > 0 && chargeAmountMinor > 0 && amountMinor < chargeAmountMinor
                  ? `Paying ${formatMoney(amountMinor, currency, locale)} of ${formatMoney(chargeAmountMinor, currency, locale)} now — the rest stays open to pay later.`
                  : "This bills the vendor for this amount, then pays it from the amount above."}
              </p>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setHasNewCharge(true)}
              className="text-[13px] text-brand hover:underline"
            >
              + This is a new charge, not an already-open bill
            </button>
          )}
        </div>
      )}

      {partyId !== "" && !hasNewCharge && openBills.length > 0 && (
        <div className="space-y-2">
          <span className="block text-[13px] font-medium text-ink">Already-open bills</span>
          <div className="divide-y divide-line-soft rounded-md border border-line">
            {openBills.map((doc) => {
              const row = allocation.find((r) => r.id === doc.id);
              return (
                <div key={doc.id} className="flex items-center gap-4 p-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[13.5px] text-ink">{doc.doc_no}</span>
                    <span className="block text-[12.5px] text-ink-3">
                      {doc.doc_date}
                      {doc.due_date && <> · due {doc.due_date}</>} · outstanding{" "}
                      {formatMoney(doc.balance_due_minor, doc.currency, locale)}
                    </span>
                  </span>
                  <span className="w-[150px] shrink-0">
                    <input
                      type="number" step="0.01" min="0"
                      max={fromMinor(doc.balance_due_minor, doc.currency as CurrencyCode)}
                      aria-label={`Allocate to ${doc.doc_no}`}
                      value={
                        overrides[doc.id] ??
                        (row ? String(fromMinor(row.minor, doc.currency as CurrencyCode)) : "")
                      }
                      onChange={(e) => setOverrides((prev) => ({ ...prev, [doc.id]: e.target.value }))}
                      className={`${inputClass} text-right font-mono`}
                    />
                  </span>
                </div>
              );
            })}
          </div>
          {unapplied !== 0 && (
            <p className={`text-[12.5px] ${unapplied < 0 ? "text-overdue" : "text-ink-2"}`}>
              {unapplied > 0
                ? `${formatMoney(unapplied, currency, locale)} will be left unapplied, held as an advance against this vendor.`
                : `That allocates ${formatMoney(-unapplied, currency, locale)} more than was paid.`}
            </p>
          )}
        </div>
      )}

      {partyId !== "" && !hasNewCharge && openBills.length === 0 && (
        <p className="rounded-md border border-line bg-paper p-4 text-[13px] text-ink-2">
          Nothing outstanding to this vendor. Recording this now is held as an advance against
          their next bill.
        </p>
      )}

      {error && <p className="rounded-md bg-overdue-tint p-3 text-[13px] text-overdue">{error}</p>}

      <button type="submit" disabled={saving || partyId === ""} className={buttonPrimaryClass}>
        {saving ? "Recording…" : "Record vendor payment"}
      </button>
    </form>
  );
}
