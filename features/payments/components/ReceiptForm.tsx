"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, fromMinor, toMinor, type CurrencyCode } from "@/lib/money";
import { inputClass, buttonPrimaryClass } from "@/lib/ui/styles";
import { filterPartiesForKind, type PartyRole } from "@/lib/parties/roles";

/**
 * Take money in, and decide what it settles.
 *
 * A receipt does not have to be allocated. A customer who transfers a round
 * figure against four invoices, or pays in advance, leaves money unapplied —
 * and that is a real state the ledger holds, not an error to force away. The
 * form allocates oldest-first by default because that is what most businesses
 * mean, and lets it be overridden line by line.
 *
 * The over-allocation rule is enforced in `allocate()`, which locks the target
 * document and refuses to exceed its balance. What happens here is convenience.
 */
export interface OpenDocument {
  id: string;
  doc_no: string;
  doc_date: string;
  due_date: string | null;
  currency: string;
  balance_due_minor: number;
}

const COPY = {
  in: {
    who: "Who paid?",
    whoPlaceholder: "Choose a party…",
    amount: "Amount received",
    when: "Received on",
    empty: "Nothing outstanding for this party. Anything recorded now is held as credit against their next invoice.",
    unappliedNote: (money: string) => (
      <>{money} will be left unapplied, held as credit against this party.</>
    ),
    overNote: (money: string) => <>That allocates {money} more than was received.</>,
    submitting: "Recording…",
    submit: "Record receipt",
  },
  out: {
    who: "Who did we pay?",
    whoPlaceholder: "Choose a vendor…",
    amount: "Amount paid",
    when: "Paid on",
    empty: "Nothing outstanding to this vendor. Anything recorded now is held as an advance against their next bill.",
    unappliedNote: (money: string) => (
      <>{money} will be left unapplied, held as an advance against this vendor.</>
    ),
    overNote: (money: string) => <>That allocates {money} more than was paid.</>,
    submitting: "Recording…",
    submit: "Record payment",
  },
} as const;

export function ReceiptForm({
  parties,
  openByParty,
  locale,
  today,
  direction = "in",
  defaultCurrency,
  onDone,
}: {
  parties: { id: string; name: string; role?: PartyRole; kind?: "client" | "vendor" | null }[];
  openByParty: Record<string, OpenDocument[]>;
  locale: string;
  today: string;
  direction?: "in" | "out";
  /**
   * A party with nothing open yet — never billed, or an advance paid before
   * their first bill arrives — has no open document to read a currency from.
   * Falling back to the organisation's own currency, rather than leaving it
   * blank, is what lets that advance actually be recorded instead of
   * silently computing to a zero amount.
   */
  defaultCurrency: string;
  onDone?: () => void;
}) {
  const copy = COPY[direction];
  // Two ReceiptForm instances (in and out) can render on the same page — a
  // static id would collide, silently breaking label association for
  // whichever instance loses. direction is always one of exactly two values
  // here, so prefixing with it is enough to keep every id page-unique.
  const id = (base: string) => `r${direction}-${base}`;
  const router = useRouter();
  const [partyId, setPartyId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState("bank");
  const [reference, setReference] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Memoised so the allocation below is not recomputed on every keystroke:
  // `?? []` builds a fresh array each render, which would change the identity
  // of a useMemo dependency every time.
  const open = useMemo(() => openByParty[partyId] ?? [], [openByParty, partyId]);
  // "in" (a receipt) is money from a client; "out" (a vendor payment) is
  // money to a vendor — never offer the other side in this dropdown.
  const eligibleParties = useMemo(
    () => filterPartiesForKind(parties, direction === "out" ? "vendor" : "client"),
    [parties, direction],
  );
  const currency = (open[0]?.currency ?? defaultCurrency) as CurrencyCode;

  const amountMinor = useMemo(() => {
    if (!currency || amount.trim() === "") return 0;
    try {
      return toMinor(Number(amount), currency);
    } catch {
      return 0;
    }
  }, [amount, currency]);

  /**
   * Oldest first, until the money runs out. Anything the user has typed into a
   * row wins over the automatic split for that row.
   */
  const allocation = useMemo(() => {
    const rows: { id: string; minor: number }[] = [];
    let left = amountMinor;
    for (const doc of open) {
      const typed = overrides[doc.id];
      let minor: number;
      if (typed !== undefined && typed.trim() !== "") {
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
  }, [amountMinor, open, overrides, currency]);

  const allocated = allocation.reduce((s, r) => s + r.minor, 0);
  const unapplied = amountMinor - allocated;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (amountMinor <= 0) {
      setError("Enter the amount received.");
      return;
    }
    if (unapplied < 0) {
      setError("That allocates more than the amount received.");
      return;
    }
    setSaving(true);
    setError("");

    const res = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        direction,
        party_id: partyId,
        amount_minor: amountMinor,
        paid_on: paidOn,
        method,
        reference_no: reference || null,
        allocations: allocation.map((r) => ({ document_id: r.id, amount_minor: r.minor })),
      }),
    });
    const body = await res.json();

    if (!res.ok) {
      setSaving(false);
      setError(body.error ?? "Something went wrong. Please try again.");
      return;
    }

    setSaving(false);
    setAmount(""); setReference(""); setOverrides({}); setPartyId("");
    onDone?.();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-line bg-white p-5">
      <div className="grid gap-4 min-[720px]:grid-cols-2">
        <div className="min-[720px]:col-span-2">
          <label htmlFor={id("party")} className="mb-1.5 block text-[13px] font-medium text-ink">
            {copy.who}
          </label>
          <select
            id={id("party")} required value={partyId}
            onChange={(e) => { setPartyId(e.target.value); setOverrides({}); }}
            className={inputClass}
          >
            <option value="">{copy.whoPlaceholder}</option>
            {eligibleParties.map((p) => {
              const docs = openByParty[p.id] ?? [];
              const outstanding = docs.reduce((s, d) => s + d.balance_due_minor, 0);
              return (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {outstanding > 0 ? ` (${formatMoney(outstanding, docs[0].currency, locale)} due)` : ""}
                </option>
              );
            })}
          </select>
        </div>

        <div>
          <label htmlFor={id("amount")} className="mb-1.5 block text-[13px] font-medium text-ink">
            {copy.amount}
          </label>
          <input
            id={id("amount")} type="number" step="0.01" min="0.01" required value={amount}
            onChange={(e) => setAmount(e.target.value)} className={`${inputClass} font-mono`}
          />
        </div>

        <div>
          <label htmlFor={id("paidon")} className="mb-1.5 block text-[13px] font-medium text-ink">
            {copy.when}
          </label>
          <input
            id={id("paidon")} type="date" required value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)} className={inputClass}
          />
        </div>

        <div>
          <label htmlFor={id("method")} className="mb-1.5 block text-[13px] font-medium text-ink">
            How
          </label>
          <select id={id("method")} value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            <option value="bank">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="cheque">Cheque</option>
            <option value="card">Card</option>
            <option value="online">Online</option>
          </select>
        </div>

        <div>
          <label htmlFor={id("ref")} className="mb-1.5 block text-[13px] font-medium text-ink">
            Reference <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <input
            id={id("ref")} value={reference} onChange={(e) => setReference(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        </div>
      </div>

      {partyId !== "" && open.length > 0 && (
        <div className="space-y-2">
          <span className="block text-[13px] font-medium text-ink">What does this settle?</span>
          <div className="divide-y divide-line-soft rounded-md border border-line">
            {open.map((doc) => {
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
                  {/* Width lives on the wrapper, not the input: inputClass
                      carries `w-full`, and which of two competing width
                      utilities wins depends on stylesheet order rather than on
                      the order they are written here. */}
                  <span className="w-[150px] shrink-0">
                    <input
                      type="number" step="0.01" min="0"
                      max={fromMinor(doc.balance_due_minor, doc.currency as CurrencyCode)}
                      aria-label={`Allocate to ${doc.doc_no}`}
                      value={
                        overrides[doc.id] ??
                        (row ? String(fromMinor(row.minor, doc.currency as CurrencyCode)) : "")
                      }
                      onChange={(e) =>
                        setOverrides((prev) => ({ ...prev, [doc.id]: e.target.value }))
                      }
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
                ? copy.unappliedNote(formatMoney(unapplied, currency, locale))
                : copy.overNote(formatMoney(-unapplied, currency, locale))}
            </p>
          )}
        </div>
      )}

      {partyId !== "" && open.length === 0 && (
        <p className="rounded-md border border-line bg-paper p-4 text-[13px] text-ink-2">
          {copy.empty}
        </p>
      )}

      {error && <p className="rounded-md bg-overdue-tint p-3 text-[13px] text-overdue">{error}</p>}

      <button type="submit" disabled={saving || partyId === ""} className={buttonPrimaryClass}>
        {saving ? copy.submitting : copy.submit}
      </button>
    </form>
  );
}
