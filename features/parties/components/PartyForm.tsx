"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, buttonPrimaryClass } from "@/lib/ui/styles";

/**
 * Add or correct a customer.
 *
 * Two fields here are load-bearing rather than decorative, and the form says
 * so rather than presenting eleven equal boxes:
 *
 *   · the region, which under a split-rate regime decides whether tax splits
 *     into two components or combines into one. Asked for ONLY under that
 *     regime, because everywhere else it means nothing.
 *   · the payment terms, which set every future invoice's due date.
 */
export interface PartyDraft {
  id?: string;
  name: string;
  region_code: string | null;
  tax_id: string | null;
  payment_terms_days: number;
  email: string | null;
  phone: string | null;
  address: string | null;
}

export function PartyForm({
  party,
  taxRegime,
  taxIdKind,
  onDone,
}: {
  party?: PartyDraft;
  taxRegime: "none" | "single_rate" | "split_rate";
  taxIdKind: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(party?.name ?? "");
  const [region, setRegion] = useState(party?.region_code ?? "");
  const [taxId, setTaxId] = useState(party?.tax_id ?? "");
  const [terms, setTerms] = useState(String(party?.payment_terms_days ?? 30));
  const [email, setEmail] = useState(party?.email ?? "");
  const [phone, setPhone] = useState(party?.phone ?? "");
  const [address, setAddress] = useState(party?.address ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const payload = {
      name,
      region_code: region || null,
      tax_id: taxId || null,
      tax_id_kind: taxId ? taxIdKind : null,
      payment_terms_days: Number(terms),
      email: email || null,
      phone: phone || null,
      address: address || null,
    };

    const res = await fetch(party?.id ? `/api/parties/${party.id}` : "/api/parties", {
      method: party?.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();

    if (!res.ok) {
      setSaving(false);
      setError(body.error ?? "Something went wrong. Please try again.");
      return;
    }

    setSaving(false);
    if (!party?.id) {
      setName(""); setRegion(""); setTaxId(""); setTerms("30");
      setEmail(""); setPhone(""); setAddress("");
    }
    onDone?.();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-line bg-white p-5">
      <div className="grid gap-4 min-[720px]:grid-cols-2">
        <div className="min-[720px]:col-span-2">
          <label htmlFor="pname" className="mb-1.5 block text-[13px] font-medium text-ink">
            Name
          </label>
          <input id="pname" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </div>

        {taxRegime === "split_rate" && (
          <div>
            <label htmlFor="pregion" className="mb-1.5 block text-[13px] font-medium text-ink">
              State code
            </label>
            <input
              id="pregion" value={region}
              onChange={(e) => setRegion(e.target.value.toUpperCase())}
              className={`${inputClass} font-mono uppercase`} placeholder="KA" maxLength={10}
            />
            <p className="mt-1.5 text-[12.5px] text-ink-3">
              Decides whether tax splits in two or combines into one on their invoices.
            </p>
          </div>
        )}

        <div>
          <label htmlFor="ptax" className="mb-1.5 block text-[13px] font-medium text-ink">
            {taxIdKind} <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <input
            id="ptax" value={taxId} onChange={(e) => setTaxId(e.target.value.toUpperCase())}
            className={`${inputClass} font-mono uppercase`}
          />
        </div>

        <div>
          <label htmlFor="pterms" className="mb-1.5 block text-[13px] font-medium text-ink">
            Payment terms
          </label>
          <input
            id="pterms" type="number" min={0} max={365} required value={terms}
            onChange={(e) => setTerms(e.target.value)} className={`${inputClass} font-mono`}
          />
          <p className="mt-1.5 text-[12.5px] text-ink-3">Days. Sets the due date on their invoices.</p>
        </div>

        <div>
          <label htmlFor="pemail" className="mb-1.5 block text-[13px] font-medium text-ink">
            Email <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <input id="pemail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </div>

        <div>
          <label htmlFor="pphone" className="mb-1.5 block text-[13px] font-medium text-ink">
            Phone <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <input id="pphone" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        </div>

        <div className="min-[720px]:col-span-2">
          <label htmlFor="paddress" className="mb-1.5 block text-[13px] font-medium text-ink">
            Address <span className="font-normal text-ink-3">(optional, prints on invoices)</span>
          </label>
          <textarea
            id="paddress" rows={2} value={address}
            onChange={(e) => setAddress(e.target.value)} className={inputClass}
          />
        </div>
      </div>

      {error && <p className="rounded-md bg-overdue-tint p-3 text-[13px] text-overdue">{error}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className={buttonPrimaryClass}>
          {saving ? "Saving…" : party?.id ? "Save changes" : "Add party"}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="text-[13.5px] text-ink-2 hover:text-ink">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
