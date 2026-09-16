"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, fromMinor, toMinor, type CurrencyCode } from "@/lib/money";
import { inputClass, buttonPrimaryClass, buttonSecondaryClass } from "@/lib/ui/styles";

/**
 * The three ways to put a document right, and the rules about which applies.
 *
 * They are not interchangeable and the screen says so rather than offering all
 * three and letting the database refuse:
 *
 *   cancel       — only while nothing has been applied. Voids the document and
 *                  frees the work to be billed again.
 *   credit note  — once money HAS moved. Leaves the invoice standing and
 *                  reduces what is owed, so the payment still has a home.
 *   apply credit — spends money already in the book: a receipt taken on
 *                  account, or a note raised earlier and not yet used up.
 *
 * Offering cancel on a part-paid invoice would be offering an action that
 * always fails, so it is hidden and the reason is stated in its place.
 */
export interface HeldCredit {
  id: string;
  kind: "payment" | "credit_note";
  label: string;
  available_minor: number;
}

export function DocumentActions({
  documentId,
  currency,
  locale,
  balanceMinor,
  appliedMinor,
  totalMinor,
  status,
  isOwner,
  heldCredit,
}: {
  documentId: string;
  currency: string;
  locale: string;
  balanceMinor: number;
  appliedMinor: number;
  totalMinor: number;
  status: string;
  isOwner: boolean;
  heldCredit: HeldCredit[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"none" | "cancel" | "credit" | "apply">("none");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [reason, setReason] = useState("");
  const [creditValue, setCreditValue] = useState("");
  const [sourceId, setSourceId] = useState(heldCredit[0]?.id ?? "");
  const [applyAmount, setApplyAmount] = useState("");

  if (status !== "issued" || !isOwner) return null;

  const money = (minor: number) => formatMoney(minor, currency, locale);
  const source = heldCredit.find((c) => c.id === sourceId);
  const nothingApplied = appliedMinor === 0;

  async function post(url: string, body: unknown) {
    setSaving(true);
    setError("");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(parsed.error ?? "Something went wrong. Please try again.");
      return false;
    }
    setOpen("none");
    setReason("");
    setCreditValue("");
    setApplyAmount("");
    router.refresh();
    return true;
  }

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-medium text-ink">Put this right</h2>

      {open === "none" && (
        <div className="flex flex-wrap items-center gap-3">
          {nothingApplied ? (
            <button type="button" onClick={() => setOpen("cancel")} className={buttonSecondaryClass}>
              Cancel this invoice
            </button>
          ) : (
            <p className="text-[13px] text-ink-3">
              This invoice has had {money(appliedMinor)} applied to it, so it cannot be
              cancelled — a credit note is the way to reduce it.
            </p>
          )}

          <button type="button" onClick={() => setOpen("credit")} className={buttonSecondaryClass}>
            Raise a credit note
          </button>

          {balanceMinor > 0 && heldCredit.length > 0 && (
            <button type="button" onClick={() => setOpen("apply")} className={buttonSecondaryClass}>
              Apply credit held
            </button>
          )}
        </div>
      )}

      {open === "cancel" && (
        <form
          className="space-y-4 rounded-[10px] border border-line bg-white p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await post(`/api/documents/${documentId}/cancel`, { reason })) router.push("/documents");
          }}
        >
          <p className="text-[13.5px] text-ink-2">
            The invoice is voided and the work on it goes back to being billable. The number
            is not reused, and the document stays readable.
          </p>
          <div>
            <label htmlFor="cancelReason" className="mb-1.5 block text-[13px] font-medium text-ink">
              Why?
            </label>
            <input
              id="cancelReason" required minLength={3} value={reason}
              onChange={(e) => setReason(e.target.value)} className={inputClass}
              placeholder="Raised against the wrong customer"
            />
            <p className="mt-1.5 text-[12.5px] text-ink-3">
              Recorded against the cancellation — it is the only record of why a number in
              your book was voided.
            </p>
          </div>
          {error && <p className="rounded-md bg-overdue-tint p-3 text-[13px] text-overdue">{error}</p>}
          <Buttons saving={saving} label="Cancel this invoice" onBack={() => setOpen("none")} />
        </form>
      )}

      {open === "credit" && (
        <form
          className="space-y-4 rounded-[10px] border border-line bg-white p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            let minor: number;
            try {
              minor = toMinor(Number(creditValue), currency as CurrencyCode);
            } catch {
              setError("That amount isn't a number we can record.");
              return;
            }
            await post(`/api/documents/${documentId}/credit-note`, {
              taxable_value_minor: minor,
              reason,
            });
          }}
        >
          <p className="text-[13.5px] text-ink-2">
            The invoice stands and a credit note reduces what is owed on it. Enter the
            amount BEFORE tax — tax is added at the same rate and treatment this invoice
            carries.
          </p>
          <div className="grid gap-4 min-[560px]:grid-cols-2">
            <div>
              <label htmlFor="creditValue" className="mb-1.5 block text-[13px] font-medium text-ink">
                Amount before tax
              </label>
              <input
                id="creditValue" type="number" step="0.01" min="0.01" required
                max={fromMinor(totalMinor, currency as CurrencyCode)}
                value={creditValue} onChange={(e) => setCreditValue(e.target.value)}
                className={`${inputClass} font-mono`}
              />
            </div>
            <div>
              <label htmlFor="creditReason" className="mb-1.5 block text-[13px] font-medium text-ink">
                Why?
              </label>
              <input
                id="creditReason" required minLength={3} value={reason}
                onChange={(e) => setReason(e.target.value)} className={inputClass}
                placeholder="Overcharged on the return leg"
              />
            </div>
          </div>
          <p className="text-[12.5px] text-ink-3">
            Applied to this invoice up to the {money(balanceMinor)} still owed. Anything
            beyond that is held as credit against this customer.
          </p>
          {error && <p className="rounded-md bg-overdue-tint p-3 text-[13px] text-overdue">{error}</p>}
          <Buttons saving={saving} label="Raise the credit note" onBack={() => setOpen("none")} />
        </form>
      )}

      {open === "apply" && (
        <form
          className="space-y-4 rounded-[10px] border border-line bg-white p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            let minor: number;
            try {
              minor = toMinor(Number(applyAmount), currency as CurrencyCode);
            } catch {
              setError("That amount isn't a number we can record.");
              return;
            }
            await post("/api/allocations", {
              target_document_id: documentId,
              amount_minor: minor,
              ...(source?.kind === "payment"
                ? { payment_id: source.id }
                : { credit_document_id: source?.id }),
            });
          }}
        >
          <p className="text-[13.5px] text-ink-2">
            Money already in the book — a receipt taken on account, or a credit note not
            yet used up.
          </p>
          <div className="grid gap-4 min-[560px]:grid-cols-2">
            <div>
              <label htmlFor="creditSource" className="mb-1.5 block text-[13px] font-medium text-ink">
                What to apply
              </label>
              <select
                id="creditSource" value={sourceId}
                onChange={(e) => {
                  setSourceId(e.target.value);
                  setApplyAmount("");
                }}
                className={inputClass}
              >
                {heldCredit.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} — {money(c.available_minor)} available
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="applyAmount" className="mb-1.5 block text-[13px] font-medium text-ink">
                How much
              </label>
              <input
                id="applyAmount" type="number" step="0.01" min="0.01" required
                max={fromMinor(
                  Math.min(balanceMinor, source?.available_minor ?? balanceMinor),
                  currency as CurrencyCode,
                )}
                value={applyAmount} onChange={(e) => setApplyAmount(e.target.value)}
                className={`${inputClass} font-mono`}
              />
              <p className="mt-1.5 text-[12.5px] text-ink-3">
                At most {money(Math.min(balanceMinor, source?.available_minor ?? 0))}.
              </p>
            </div>
          </div>
          {error && <p className="rounded-md bg-overdue-tint p-3 text-[13px] text-overdue">{error}</p>}
          <Buttons saving={saving} label="Apply it" onBack={() => setOpen("none")} />
        </form>
      )}
    </section>
  );
}

function Buttons({ saving, label, onBack }: { saving: boolean; label: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <button type="submit" disabled={saving} className={buttonPrimaryClass}>
        {saving ? "Working…" : label}
      </button>
      <button type="button" onClick={onBack} className="text-[13.5px] text-ink-2 hover:text-ink">
        Back
      </button>
    </div>
  );
}
