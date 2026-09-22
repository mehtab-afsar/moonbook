"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, toMinor } from "@/lib/money";
import { inputClass, buttonPrimaryClass } from "@/lib/ui/styles";
import { filterPartiesForKind, type PartyRole } from "@/lib/parties/roles";
import { PartyCombobox } from "@/features/parties/components/PartyCombobox";

/**
 * Logistics' own recording form. Fixed fields, not a configurable field
 * system — this vertical serves one trade, so there is nothing to
 * configure.
 *
 * Services only — always receivable. A vendor charge is no longer logged
 * here as its own activity; it's created on the spot, from the vendor's own
 * invoice number, at the moment of paying them (see VendorPaymentForm on the
 * Documents page). "Assigned vendor" below is purely an internal note about
 * who's doing the work — nothing that renders the client's invoice reads it.
 */
export function ActivityForm({
  parties,
  originSuggestions,
  destinationSuggestions,
  currency,
  locale,
  onDone,
}: {
  parties: { id: string; name: string; role?: PartyRole; kind?: "client" | "vendor" | null }[];
  /** Places used before, org-wide — offered as suggestions, never enforced;
   *  typing anything else is always fine. */
  originSuggestions: string[];
  destinationSuggestions: string[];
  currency: string;
  locale: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const clientParties = useMemo(() => filterPartiesForKind(parties, "client"), [parties]);
  const vendorParties = useMemo(() => filterPartiesForKind(parties, "vendor"), [parties]);
  const [partyId, setPartyId] = useState("");
  const [billToPartyId, setBillToPartyId] = useState("");
  const [assignedVendorId, setAssignedVendorId] = useState("");
  const [occurredOn, setOccurredOn] = useState(new Date().toISOString().slice(0, 10));
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [loadType, setLoadType] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
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
        direction: "receivable",
        party_id: partyId,
        bill_to_party_id: billToPartyId || null,
        assigned_vendor_id: assignedVendorId || null,
        occurred_on: occurredOn,
        amount_minor: amountMinor,
        direct_cost_minor: costMinor,
        origin: origin || null,
        destination: destination || null,
        vehicle_no: vehicleNo || null,
        load_type: loadType || null,
        reference: reference || null,
        distance_km: distanceKm.trim() ? Number(distanceKm) : null,
      }),
    });
    const body = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(body.error ?? "Could not record this.");
      return;
    }
    setPartyId(""); setBillToPartyId(""); setAssignedVendorId(""); setOrigin(""); setDestination("");
    setVehicleNo(""); setLoadType(""); setDistanceKm(""); setAmount("");
    setDirectCost(""); setReference("");
    onDone?.();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-line bg-white p-5">
      <div className="grid gap-3 min-[640px]:grid-cols-3">
        <Labelled label="Client" htmlFor="party">
          <PartyCombobox id="party" required parties={clientParties} value={partyId} onChange={setPartyId} />
        </Labelled>

        <Labelled label="Bill to (if different)" htmlFor="billTo">
          <select id="billTo" value={billToPartyId} onChange={(e) => setBillToPartyId(e.target.value)} className={inputClass}>
            <option value="">Same as party</option>
            {clientParties.filter((p) => p.id !== partyId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Labelled>

        <Labelled label="Date" htmlFor="date">
          <input id="date" type="date" required value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} className={`${inputClass} font-mono`} />
        </Labelled>
      </div>

      <div className="grid gap-3 border-t border-line-soft pt-4 min-[640px]:grid-cols-2">
        <Labelled label="Origin" htmlFor="origin">
          <input
            id="origin" required list="origin-suggestions" value={origin}
            onChange={(e) => setOrigin(e.target.value)} className={inputClass}
          />
          <datalist id="origin-suggestions">
            {originSuggestions.map((o) => <option key={o} value={o} />)}
          </datalist>
        </Labelled>
        <Labelled label="Destination" htmlFor="destination">
          <input
            id="destination" required list="destination-suggestions" value={destination}
            onChange={(e) => setDestination(e.target.value)} className={inputClass}
          />
          <datalist id="destination-suggestions">
            {destinationSuggestions.map((d) => <option key={d} value={d} />)}
          </datalist>
        </Labelled>
        <Labelled label="Distance (km, optional)" htmlFor="distance">
          <input
            id="distance" type="number" step="0.1" min="0" value={distanceKm}
            onChange={(e) => setDistanceKm(e.target.value)} className={`${inputClass} font-mono`}
          />
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
        <Labelled label="Assigned vendor (optional, internal only)" htmlFor="assignedVendor">
          {/* filterPartiesForKind is permissive toward unclassified parties
              (kind unset, no billing history) so a brand-new vendor can be
              assigned here before their first bill exists — it only ever
              excludes a party explicitly added as a client. */}
          <PartyCombobox
            id="assignedVendor" parties={vendorParties}
            value={assignedVendorId} onChange={setAssignedVendorId}
            placeholder="Not assigned yet"
          />
        </Labelled>
      </div>

      <div className="grid gap-3 border-t border-line-soft pt-4 min-[640px]:grid-cols-3">
        <Labelled label="Reference (optional)" htmlFor="ref">
          <input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
        </Labelled>
        <Labelled label={`Amount (${currency})`} htmlFor="amount">
          <input id="amount" type="number" step="any" required value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputClass} font-mono`} />
        </Labelled>
        <Labelled label={`Direct cost (${currency}, optional)`} htmlFor="cost">
          <input id="cost" type="number" step="any" min="0" value={directCost} onChange={(e) => setDirectCost(e.target.value)} className={`${inputClass} font-mono`} />
        </Labelled>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4">
        <p className="text-[13.5px] text-ink-2">
          {amountMinor !== null && (
            <>
              Amount: <span className="font-mono font-medium text-ink">{formatMoney(amountMinor, currency, locale)}</span>
              {costMinor !== null && (
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
