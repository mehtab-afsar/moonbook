"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toMinor, type CurrencyCode } from "@/lib/money";
import { inputClass, buttonPrimaryClass } from "@/lib/ui/styles";

/**
 * Overhead, logged in one line: rent, salaries, subscriptions — whatever
 * isn't tied to any one job. Direct job cost belongs on the activity itself
 * (see ActivityForm's "Direct cost" field) and has nothing to do with this
 * form.
 */
export function ExpenseForm({
  parties,
  currency,
  today,
}: {
  parties: { id: string; name: string }[];
  currency: string;
  today: string;
}) {
  const router = useRouter();
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [incurredOn, setIncurredOn] = useState(today);
  const [partyId, setPartyId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let amountMinor: number;
    try {
      amountMinor = toMinor(Number(amount), currency as CurrencyCode);
    } catch {
      setError("That amount isn't a number we can record.");
      return;
    }
    if (amountMinor <= 0) {
      setError("Enter the amount spent.");
      return;
    }
    setSaving(true);
    setError("");

    const res = await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category,
        description: description || null,
        amount_minor: amountMinor,
        incurred_on: incurredOn,
        party_id: partyId || null,
      }),
    });
    const body = await res.json();

    if (!res.ok) {
      setSaving(false);
      setError(body.error ?? "Something went wrong. Please try again.");
      return;
    }

    setSaving(false);
    setCategory(""); setDescription(""); setAmount(""); setPartyId("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-line bg-white p-5">
      <div className="grid gap-4 min-[720px]:grid-cols-2">
        <div>
          <label htmlFor="ecategory" className="mb-1.5 block text-[13px] font-medium text-ink">
            Category
          </label>
          <input
            id="ecategory" required value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Rent, salaries, fuel…"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="eamount" className="mb-1.5 block text-[13px] font-medium text-ink">
            Amount ({currency})
          </label>
          <input
            id="eamount" type="number" step="0.01" min="0.01" required value={amount}
            onChange={(e) => setAmount(e.target.value)} className={`${inputClass} font-mono`}
          />
        </div>

        <div>
          <label htmlFor="eincurred" className="mb-1.5 block text-[13px] font-medium text-ink">
            Incurred on
          </label>
          <input
            id="eincurred" type="date" required value={incurredOn}
            onChange={(e) => setIncurredOn(e.target.value)} className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="eparty" className="mb-1.5 block text-[13px] font-medium text-ink">
            Party <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <select id="eparty" value={partyId} onChange={(e) => setPartyId(e.target.value)} className={inputClass}>
            <option value="">Not tied to a party</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="min-[720px]:col-span-2">
          <label htmlFor="edesc" className="mb-1.5 block text-[13px] font-medium text-ink">
            Description <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <input
            id="edesc" value={description} onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {error && <p className="rounded-md bg-overdue-tint p-3 text-[13px] text-overdue">{error}</p>}

      <button type="submit" disabled={saving} className={buttonPrimaryClass}>
        {saving ? "Recording…" : "Record expense"}
      </button>
    </form>
  );
}
