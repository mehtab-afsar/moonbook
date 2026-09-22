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
  kind: "client" | "vendor" | null;
  region_code: string | null;
  tax_id: string | null;
  payment_terms_days: number;
  email: string | null;
  phone: string | null;
  address: string | null;
  payout_bank_name: string | null;
  payout_account_no: string | null;
  payout_ifsc_or_routing: string | null;
  payout_upi_id: string | null;
}

export function PartyForm({
  party,
  kind,
  existingNames,
  taxRegime,
  taxIdKind,
  onDone,
}: {
  party?: PartyDraft;
  /** Which tab this form was opened from — stamped on a new party as its kind. */
  kind: "client" | "vendor";
  /** Every other party's name in this org, for the duplicate-name check below. */
  existingNames: string[];
  taxRegime: "none" | "single_rate" | "split_rate";
  taxIdKind: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(party?.name ?? "");
  const [dupeConfirm, setDupeConfirm] = useState<string | null>(null);
  const [region, setRegion] = useState(party?.region_code ?? "");
  const [taxId, setTaxId] = useState(party?.tax_id ?? "");
  const [terms, setTerms] = useState(String(party?.payment_terms_days ?? 30));
  const [email, setEmail] = useState(party?.email ?? "");
  const [phone, setPhone] = useState(party?.phone ?? "");
  const [address, setAddress] = useState(party?.address ?? "");
  const [bankName, setBankName] = useState(party?.payout_bank_name ?? "");
  const [accountNo, setAccountNo] = useState(party?.payout_account_no ?? "");
  const [ifsc, setIfsc] = useState(party?.payout_ifsc_or_routing ?? "");
  const [upiId, setUpiId] = useState(party?.payout_upi_id ?? "");
  const [showPayout, setShowPayout] = useState(
    Boolean(party?.payout_bank_name || party?.payout_account_no || party?.payout_ifsc_or_routing || party?.payout_upi_id),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  /** "Name", "Name 2", "Name 3" — the first not already taken. */
  function nextAvailableName(base: string): string {
    const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
    if (!taken.has(base.trim().toLowerCase())) return base;
    let n = 2;
    while (taken.has(`${base.trim()} ${n}`.toLowerCase())) n++;
    return `${base.trim()} ${n}`;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Only new parties are checked — editing an existing one keeps its name
    // even if it now happens to match another, rather than surprising a
    // correction with a duplicate prompt.
    const isDuplicate = !party?.id && existingNames.some((n) => n.trim().toLowerCase() === name.trim().toLowerCase());
    if (isDuplicate) {
      setDupeConfirm(name.trim());
      return;
    }
    void doSubmit(name.trim());
  }

  async function doSubmit(finalName: string) {
    setSaving(true);
    setError("");
    setDupeConfirm(null);

    const payload = {
      name: finalName,
      kind: party?.kind ?? kind,
      region_code: region || null,
      tax_id: taxId || null,
      tax_id_kind: taxId ? taxIdKind : null,
      payment_terms_days: Number(terms),
      email: email || null,
      phone: phone || null,
      address: address || null,
      payout_bank_name: bankName || null,
      payout_account_no: accountNo || null,
      payout_ifsc_or_routing: ifsc || null,
      payout_upi_id: upiId || null,
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
      setBankName(""); setAccountNo(""); setIfsc(""); setUpiId(""); setShowPayout(false);
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
          <input
            id="pname" required value={name}
            onChange={(e) => { setName(e.target.value); setDupeConfirm(null); }}
            className={inputClass}
          />
          {dupeConfirm !== null && (
            <div className="mt-2 rounded-md border border-pending bg-pending-tint p-3 text-[13px] text-pending-ink">
              <p>A party named &quot;{dupeConfirm}&quot; already exists. Add it anyway?</p>
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void doSubmit(nextAvailableName(dupeConfirm))}
                  className="font-medium text-brand hover:underline"
                >
                  Add anyway — saved as &quot;{nextAvailableName(dupeConfirm)}&quot;
                </button>
                <button type="button" onClick={() => setDupeConfirm(null)} className="text-ink-2 hover:text-ink">
                  Cancel
                </button>
              </div>
            </div>
          )}
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
            Mobile number <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <input id="pphone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={`${inputClass} font-mono`} />
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

      <div className="border-t border-line-soft pt-4">
        {showPayout ? (
          <>
            <p className="mb-3 text-[13px] font-medium text-ink">
              Payout details <span className="font-normal text-ink-3">(if you ever pay this party)</span>
            </p>
            <div className="grid gap-4 min-[720px]:grid-cols-2">
              <div>
                <label htmlFor="pbank" className="mb-1.5 block text-[13px] font-medium text-ink">
                  Bank name <span className="font-normal text-ink-3">(optional)</span>
                </label>
                <input id="pbank" value={bankName} onChange={(e) => setBankName(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label htmlFor="pacct" className="mb-1.5 block text-[13px] font-medium text-ink">
                  Account number <span className="font-normal text-ink-3">(optional)</span>
                </label>
                <input id="pacct" value={accountNo} onChange={(e) => setAccountNo(e.target.value)} className={`${inputClass} font-mono`} />
              </div>
              <div>
                <label htmlFor="pifsc" className="mb-1.5 block text-[13px] font-medium text-ink">
                  IFSC / routing code <span className="font-normal text-ink-3">(optional)</span>
                </label>
                <input id="pifsc" value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} className={`${inputClass} font-mono uppercase`} />
              </div>
              <div>
                <label htmlFor="pupi" className="mb-1.5 block text-[13px] font-medium text-ink">
                  UPI ID <span className="font-normal text-ink-3">(optional)</span>
                </label>
                <input id="pupi" value={upiId} onChange={(e) => setUpiId(e.target.value)} className={`${inputClass} font-mono`} />
              </div>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setShowPayout(true)}
            className="text-[13px] text-brand hover:underline"
          >
            + Add payout details (if you pay this party)
          </button>
        )}
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
