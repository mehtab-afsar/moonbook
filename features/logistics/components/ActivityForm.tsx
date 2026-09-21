"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, toMinor } from "@/lib/money";
import { inputClass, buttonPrimaryClass } from "@/lib/ui/styles";

/**
 * Logistics' own recording form. Fixed fields, not a configurable field
 * system — this vertical serves one trade, so there is nothing to
 * configure. Direction picks the shape: a trip (receivable) or a vendor
 * charge (payable), the same distinction the shared engine's activity_types
 * express as data.
 */
export function ActivityForm({
  parties,
  currency,
  locale,
}: {
  parties: { id: string; name: string }[];
  currency: string;
  locale: string;
}) {
  const router = useRouter();
  const [direction, setDirection] = useState<"receivable" | "payable">("receivable");
  const [partyId, setPartyId] = useState("");
  const [billToPartyId, setBillToPartyId] = useState("");
  const [occurredOn, setOccurredOn] = useState(new Date().toISOString().slice(0, 10));
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [loadType, setLoadType] = useState("");
  const [vendorRef, setVendorRef] = useState("");
  const [amount, setAmount] = useState("");
  const [directCost, setDirectCost] = useState("");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const amountMinor = useMemo(() => {
    if (!amount.trim()) return null;
    try { return toMinor(Number(amount), currency); } catch { return null; }
  }, [amount, currency]);
  const costMinor = useMemo(() => {
    if (!directCost.trim()) return null;
    try { return toMinor(Number(directCost), currency); } catch { return null; }
  }, [directCost, currency]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const res = await fetch("/api/logistics/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        direction,
        party_id: partyId,
        bill_to_party_id: billToPartyId || null,
        occurred_on: occurredOn,
        amount_minor: amountMinor,
        direct_cost_minor: direction === "receivable" ? costMinor : null,
        origin: direction === "receivable" ? origin || null : null,
        destination: direction === "receivable" ? destination || null : null,
        vehicle_no: direction === "receivable" ? vehicleNo || null : null,
        load_type: direction === "receivable" ? loadType || null : null,
        vendor_ref: direction === "payable" ? vendorRef || null : null,
        reference: reference || null,
      }),
    });
    const body = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(body.error ?? "Could not record this.");
      return;
    }
    setPartyId(""); setBillToPartyId(""); setOrigin(""); setDestination("");
    setVehicleNo(""); setLoadType(""); setVendorRef(""); setAmount("");
    setDirectCost(""); setReference("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-line bg-white p-5">
      <div className="grid gap-3 min-[640px]:grid-cols-3">
        <Labelled label="What" htmlFor="direction">
          <select
            id="direction" value={direction}
            onChange={(e) => setDirection(e.target.value as "receivable" | "payable")}
            className={inputClass}
          >
            <option value="receivable">Trip</option>
            <option value="payable">Vendor charge (we pay)</option>
          </select>
        </Labelled>

        <Labelled label="Party" htmlFor="party">
          <select id="party" required value={partyId} onChange={(e) => setPartyId(e.target.value)} className={inputClass}>
            <option value="">Select…</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Labelled>

        <Labelled label="Bill to (if different)" htmlFor="billTo">
          <select id="billTo" value={billToPartyId} onChange={(e) => setBillToPartyId(e.target.value)} className={inputClass}>
            <option value="">Same as party</option>
            {parties.filter((p) => p.id !== partyId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Labelled>

        <Labelled label="Date" htmlFor="date">
          <input id="date" type="date" required value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} className={`${inputClass} font-mono`} />
        </Labelled>
      </div>

      {direction === "receivable" ? (
        <div className="grid gap-3 border-t border-line-soft pt-4 min-[640px]:grid-cols-2">
          <Labelled label="Origin" htmlFor="origin">
            <input id="origin" required value={origin} onChange={(e) => setOrigin(e.target.value)} className={inputClass} />
          </Labelled>
          <Labelled label="Destination" htmlFor="destination">
            <input id="destination" required value={destination} onChange={(e) => setDestination(e.target.value)} className={inputClass} />
          </Labelled>
          <Labelled label="Vehicle no. (optional)" htmlFor="vehicle">
            <input id="vehicle" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} className={inputClass} />
          </Labelled>
          <Labelled label="Load type (optional)" htmlFor="loadType">
            <select id="loadType" value={loadType} onChange={(e) => setLoadType(e.target.value)} className={inputClass}>
              <option value="">Select…</option>
              <option value="Full truckload">Full truckload</option>
              <option value="Part load">Part load</option>
              <option value="Express">Express</option>
            </select>
          </Labelled>
        </div>
      ) : (
        <div className="grid gap-3 border-t border-line-soft pt-4 min-[640px]:grid-cols-2">
          <Labelled label="Vendor invoice / LR no. (optional)" htmlFor="vendorRef">
            <input id="vendorRef" value={vendorRef} onChange={(e) => setVendorRef(e.target.value)} className={inputClass} />
          </Labelled>
        </div>
      )}

      <div className="grid gap-3 border-t border-line-soft pt-4 min-[640px]:grid-cols-3">
        <Labelled label="Reference (optional)" htmlFor="ref">
          <input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
        </Labelled>
        <Labelled label={`Amount (${currency})`} htmlFor="amount">
          <input id="amount" type="number" step="any" required value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputClass} font-mono`} />
        </Labelled>
        {direction === "receivable" && (
          <Labelled label={`Direct cost (${currency}, optional)`} htmlFor="cost">
            <input id="cost" type="number" step="any" min="0" value={directCost} onChange={(e) => setDirectCost(e.target.value)} className={`${inputClass} font-mono`} />
          </Labelled>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4">
        <p className="text-[13.5px] text-ink-2">
          {amountMinor !== null && (
            <>
              Amount: <span className="font-mono font-medium text-ink">{formatMoney(amountMinor, currency, locale)}</span>
              {direction === "receivable" && costMinor !== null && (
                <span className="text-ink-3">
                  {" "}
                  · Margin: <span className="font-mono font-medium text-ink">{formatMoney(amountMinor - costMinor, currency, locale)}</span>
                </span>
              )}
            </>
          )}
        </p>
        <button type="submit" disabled={saving} className={buttonPrimaryClass}>
          {saving ? "Saving…" : "Record"}
        </button>
      </div>

      {error && <p className="rounded-md bg-overdue-tint p-3 text-[13px] text-overdue">{error}</p>}
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
