"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { inputClass, buttonPrimaryClass } from "@/lib/ui/styles";
import { PLASTICS_GRADES } from "@/lib/domain";
import { filterPartiesForKind, type PartyRole } from "@/lib/parties/roles";
import { PartyCombobox } from "@/features/parties/components/PartyCombobox";

const MATERIALS_IN = ["PET", "HDPE", "LDPE", "PP", "Mixed plastic", "Cardboard", "Ferrous", "Aluminium", "Copper"];
const MATERIALS_OUT = ["PET flake", "HDPE flake", "LDPE flake", "PP granule", "Baled cardboard", "Ferrous", "Aluminium", "Copper"];

/**
 * No direct-cost field, on purpose: scrap margin is a PERIOD figure, not a
 * per-load one — what's bought Monday doesn't map to what's sold Friday.
 * Surfacing a per-activity margin here would print fiction, the same
 * reasoning that sets uses_job_margin=false for material_in/material_out
 * in the shared engine (see 20260922000001_scrap_no_job_margin.sql).
 */
export function ActivityForm({
  parties,
  currency,
  locale,
  onDone,
}: {
  parties: { id: string; name: string; role?: PartyRole; kind?: "client" | "vendor" | null }[];
  currency: string;
  locale: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [direction, setDirection] = useState<"payable" | "receivable">("payable");
  const [partyId, setPartyId] = useState("");
  const [billToPartyId, setBillToPartyId] = useState("");
  const [occurredOn, setOccurredOn] = useState(new Date().toISOString().slice(0, 10));
  const [material, setMaterial] = useState("");
  const [grade, setGrade] = useState("");
  const [netWeightKg, setNetWeightKg] = useState("");
  const [ratePerKg, setRatePerKg] = useState("");
  const [ticketNo, setTicketNo] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [reference, setReference] = useState("");
  const [assignedVendorId, setAssignedVendorId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Purchase (payable) owes a vendor (a collector); Sale (receivable) bills
  // a client — the party picker follows direction, never mixing the two.
  const eligibleParties = useMemo(
    () => filterPartiesForKind(parties, direction === "payable" ? "vendor" : "client"),
    [parties, direction],
  );
  // Who's actually handling this — a hauler or agent, distinct from the
  // counterparty above. Purely internal, same field logistics has.
  const vendorParties = useMemo(() => filterPartiesForKind(parties, "vendor"), [parties]);
  const materials = direction === "payable" ? MATERIALS_IN : MATERIALS_OUT;
  const weight = Number(netWeightKg);
  const rate = Number(ratePerKg);
  const previewMinor = weight > 0 && rate >= 0 ? Math.round(weight * rate * 100) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError("");

    const res = await fetch("/api/plastics/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        direction, party_id: partyId, bill_to_party_id: billToPartyId || null,
        occurred_on: occurredOn, material, grade: grade || null,
        net_weight_kg: weight, rate_per_kg: rate,
        ticket_no: direction === "payable" ? ticketNo || null : null,
        vehicle_no: direction === "receivable" ? vehicleNo || null : null,
        direct_cost_minor: null,
        reference: reference || null,
        assigned_vendor_id: assignedVendorId || null,
      }),
    });
    const body = await res.json();
    setSaving(false);
    if (!res.ok) { setError(body.error ?? "Could not record this."); return; }
    setPartyId(""); setBillToPartyId(""); setMaterial(""); setGrade("");
    setNetWeightKg(""); setRatePerKg(""); setTicketNo(""); setVehicleNo("");
    setReference(""); setAssignedVendorId("");
    onDone?.();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-line bg-white p-5">
      <div className="grid gap-3 min-[640px]:grid-cols-3">
        <Labelled label="What" htmlFor="direction">
          <select id="direction" value={direction} onChange={(e) => { setDirection(e.target.value as "payable" | "receivable"); setMaterial(""); }} className={inputClass}>
            <option value="payable">Purchase (we pay)</option>
            <option value="receivable">Sale</option>
          </select>
        </Labelled>
        <Labelled label="Party" htmlFor="party">
          <select id="party" required value={partyId} onChange={(e) => setPartyId(e.target.value)} className={inputClass}>
            <option value="">Select…</option>
            {eligibleParties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Labelled>
        <Labelled label="Bill to (if different)" htmlFor="billTo">
          <select id="billTo" value={billToPartyId} onChange={(e) => setBillToPartyId(e.target.value)} className={inputClass}>
            <option value="">Same as party</option>
            {eligibleParties.filter((p) => p.id !== partyId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Labelled>
      </div>

      <div className="grid gap-3 border-t border-line-soft pt-4 min-[640px]:grid-cols-3">
        <Labelled label="Date" htmlFor="date">
          <input id="date" type="date" required value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} className={`${inputClass} font-mono`} />
        </Labelled>
        <Labelled label="Material" htmlFor="material">
          <select id="material" required value={material} onChange={(e) => setMaterial(e.target.value)} className={inputClass}>
            <option value="">Select…</option>
            {materials.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Labelled>
        <Labelled label="Grade (optional)" htmlFor="grade">
          <select id="grade" value={grade} onChange={(e) => setGrade(e.target.value)} className={inputClass}>
            <option value="">Select…</option>
            {PLASTICS_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Labelled>
      </div>

      <div className="grid gap-3 border-t border-line-soft pt-4 min-[640px]:grid-cols-3">
        <Labelled label="Net weight (kg)" htmlFor="weight">
          <input id="weight" type="number" step="any" min="0" required value={netWeightKg} onChange={(e) => setNetWeightKg(e.target.value)} className={`${inputClass} font-mono`} />
        </Labelled>
        <Labelled label={`Rate per kg (${currency})`} htmlFor="rate">
          <input id="rate" type="number" step="any" min="0" required value={ratePerKg} onChange={(e) => setRatePerKg(e.target.value)} className={`${inputClass} font-mono`} />
        </Labelled>
        {direction === "payable" ? (
          <Labelled label="Weighbridge slip (optional)" htmlFor="ticket">
            <input id="ticket" value={ticketNo} onChange={(e) => setTicketNo(e.target.value)} className={inputClass} />
          </Labelled>
        ) : (
          <Labelled label="Vehicle no. (optional)" htmlFor="vehicle">
            <input id="vehicle" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} className={inputClass} />
          </Labelled>
        )}
      </div>

      <div className="grid gap-3 border-t border-line-soft pt-4 min-[640px]:grid-cols-2">
        <Labelled label="Reference (optional)" htmlFor="ref">
          <input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
        </Labelled>
        <Labelled label="Assigned vendor (optional, internal only)" htmlFor="assignedVendor">
          <PartyCombobox
            id="assignedVendor" parties={vendorParties}
            value={assignedVendorId} onChange={setAssignedVendorId}
            placeholder="Not assigned yet"
          />
        </Labelled>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4">
        <p className="text-[13.5px] text-ink-2">
          {previewMinor !== null && (
            <>Amount: <span className="font-mono font-medium text-ink">{formatMoney(previewMinor, currency, locale)}</span> <span className="text-ink-3">· {netWeightKg}kg × {ratePerKg}/kg</span></>
          )}
        </p>
        <button type="submit" disabled={saving} className={buttonPrimaryClass}>{saving ? "Saving…" : "Record"}</button>
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
