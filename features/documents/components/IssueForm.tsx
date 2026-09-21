"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { inputClass, buttonPrimaryClass } from "@/lib/ui/styles";

/**
 * Bill work that has already been recorded.
 *
 * The form knows nothing about any industry. It lists that party's completed
 * activities by the label their own activity type carries — "Trip", "Pickup",
 * "Service" — and the tax is not computed here at all. The server does that,
 * from the organisation's regime and the two regions, which is why a browser
 * cannot name its own tax.
 *
 * The preview below is therefore explicitly a preview: it shows the taxable
 * value, which the client can know, and says plainly that the tax is settled
 * server-side rather than guessing at a number that might not match.
 */
export interface BillableActivity {
  id: string;
  label: string;
  occurred_on: string;
  reference: string | null;
  amount_minor: number;
  currency: string;
  detail: string | null;
}

export interface PartyOption {
  id: string;
  name: string;
  payment_terms_days: number;
}

const COPY = {
  invoice: {
    who: "Who are you billing?",
    whoPlaceholder: "Choose a party…",
    countSuffix: (n: number) => ` — ${n} ready to bill`,
    what: "What are you billing for?",
    empty:
      "Nothing completed and unbilled for this party. Work has to be marked completed in the activity log before it can be invoiced.",
    docDate: "Invoice date",
    docDateHint: "Decides which financial year's series numbers this invoice.",
    submitting: "Issuing…",
    submit: "Issue invoice",
  },
  bill: {
    who: "Who is this owed to?",
    whoPlaceholder: "Choose a vendor…",
    countSuffix: (n: number) => ` — ${n} ready to bill`,
    what: "What are you being billed for?",
    empty:
      "Nothing completed and unbilled for this vendor. Work has to be marked completed in the activity log before it can be billed.",
    docDate: "Bill date",
    docDateHint: "Decides which financial year's series numbers this bill.",
    submitting: "Recording…",
    submit: "Record bill",
  },
} as const;

export function IssueForm({
  parties,
  activitiesByParty,
  locale,
  today,
  docKind = "invoice",
}: {
  parties: PartyOption[];
  activitiesByParty: Record<string, BillableActivity[]>;
  locale: string;
  today: string;
  docKind?: "invoice" | "bill";
}) {
  const copy = COPY[docKind];
  const router = useRouter();
  const [partyId, setPartyId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [docDate, setDocDate] = useState(today);
  const [treatment, setTreatment] = useState<"forward" | "reverse_charge" | "exempt">("forward");
  const [notes, setNotes] = useState("");
  const [partyDocNo, setPartyDocNo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const party = parties.find((p) => p.id === partyId);
  const available = activitiesByParty[partyId] ?? [];

  const dueDate = useMemo(() => {
    if (!party) return "";
    const d = new Date(`${docDate}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return "";
    d.setUTCDate(d.getUTCDate() + party.payment_terms_days);
    return d.toISOString().slice(0, 10);
  }, [docDate, party]);

  const chosen = available.filter((a) => selected.has(a.id));
  const taxableValueMinor = chosen.reduce((sum, a) => sum + a.amount_minor, 0);
  const currency = chosen[0]?.currency ?? available[0]?.currency ?? "";

  function pickParty(id: string) {
    setPartyId(id);
    // Selections belong to the previous party's work and would otherwise be
    // submitted against this one.
    setSelected(new Set());
    setError("");
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (chosen.length === 0) {
      setError("Choose at least one piece of work to bill.");
      return;
    }
    if (docKind === "bill" && partyDocNo.trim() === "") {
      setError("Enter the vendor's own invoice or reference number — a bill isn't ours to number.");
      return;
    }
    setSaving(true);
    setError("");

    const res = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        doc_kind: docKind,
        counterparty_id: partyId,
        doc_date: docDate,
        due_date: dueDate || null,
        activity_ids: [...selected],
        tax_treatment: treatment,
        notes: notes || null,
        party_doc_no: docKind === "bill" ? partyDocNo.trim() : null,
      }),
    });
    const body = await res.json();

    if (!res.ok) {
      setSaving(false);
      setError(body.error ?? "Something went wrong. Please try again.");
      return;
    }
    router.push(`/documents/${body.data.document_id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="max-w-[760px] space-y-5">
      <div>
        <label htmlFor="party" className="mb-1.5 block text-[13px] font-medium text-ink">
          {copy.who}
        </label>
        <select id="party" required value={partyId} onChange={(e) => pickParty(e.target.value)} className={inputClass}>
          <option value="">{copy.whoPlaceholder}</option>
          {parties.map((p) => {
            const count = activitiesByParty[p.id]?.length ?? 0;
            return (
              <option key={p.id} value={p.id}>
                {p.name}
                {count > 0 ? copy.countSuffix(count) : ""}
              </option>
            );
          })}
        </select>
      </div>

      {partyId !== "" && (
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-ink">{copy.what}</span>
          {available.length === 0 ? (
            <p className="rounded-md border border-line bg-paper p-4 text-[13px] text-ink-2">
              {copy.empty}
            </p>
          ) : (
            <div className="divide-y divide-line-soft rounded-md border border-line bg-white">
              {available.map((a) => (
                <label key={a.id} className="flex cursor-pointer items-start gap-3 p-3.5 hover:bg-paper">
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={() => toggle(a.id)}
                    className="mt-0.5 size-4 shrink-0 accent-brand"
                  />
                  <span className="flex-1">
                    <span className="block text-[14px] font-medium text-ink">
                      {a.label}
                      {a.reference && <span className="ml-2 font-normal text-ink-3">{a.reference}</span>}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] text-ink-2">
                      {a.occurred_on}
                      {a.detail && <span> · {a.detail}</span>}
                    </span>
                  </span>
                  <span className="font-mono text-[13.5px] text-ink">
                    {formatMoney(a.amount_minor, a.currency, locale)}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 min-[560px]:grid-cols-2">
        <div>
          <label htmlFor="docDate" className="mb-1.5 block text-[13px] font-medium text-ink">
            {copy.docDate}
          </label>
          <input
            id="docDate" type="date" required value={docDate}
            onChange={(e) => setDocDate(e.target.value)} className={inputClass}
          />
          <p className="mt-1.5 text-[12.5px] text-ink-3">
            {copy.docDateHint}
          </p>
        </div>
        <div>
          <label htmlFor="dueDate" className="mb-1.5 block text-[13px] font-medium text-ink">
            Due
          </label>
          <input id="dueDate" type="date" value={dueDate} readOnly className={`${inputClass} bg-paper`} />
          <p className="mt-1.5 text-[12.5px] text-ink-3">
            {party ? `${party.payment_terms_days} days, from this party's terms.` : "From the party's terms."}
          </p>
        </div>
      </div>

      {docKind === "bill" && (
        <div>
          <label htmlFor="partyDocNo" className="mb-1.5 block text-[13px] font-medium text-ink">
            Vendor&apos;s invoice / reference no.
          </label>
          <input
            id="partyDocNo" required value={partyDocNo}
            onChange={(e) => setPartyDocNo(e.target.value)} className={`${inputClass} font-mono`}
          />
          <p className="mt-1.5 text-[12.5px] text-ink-3">
            A bill is the vendor&apos;s own document — it carries their number, not ours.
          </p>
        </div>
      )}

      <div>
        <label htmlFor="treatment" className="mb-1.5 block text-[13px] font-medium text-ink">
          Tax treatment
        </label>
        <select
          id="treatment" value={treatment}
          onChange={(e) => setTreatment(e.target.value as typeof treatment)} className={inputClass}
        >
          <option value="forward">Charge tax as normal</option>
          <option value="reverse_charge">
            {docKind === "invoice" ? "Reverse charge — the customer pays the tax" : "Reverse charge — you pay the tax"}
          </option>
          <option value="exempt">Exempt or nil-rated</option>
        </select>
      </div>

      <div>
        <label htmlFor="notes" className="mb-1.5 block text-[13px] font-medium text-ink">
          Notes <span className="font-normal text-ink-3">(optional, prints on the {docKind})</span>
        </label>
        <textarea
          id="notes" rows={2} value={notes}
          onChange={(e) => setNotes(e.target.value)} className={inputClass}
        />
      </div>

      {chosen.length > 0 && (
        <div className="rounded-md border border-line bg-paper p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-ink-2">
              {chosen.length} item{chosen.length === 1 ? "" : "s"}, taxable value
            </span>
            <span className="font-mono text-[16px] font-semibold text-ink">
              {formatMoney(taxableValueMinor, currency, locale)}
            </span>
          </div>
          <p className="mt-1.5 text-[12.5px] text-ink-3">
            {treatment === "forward"
              ? `Tax is worked out on the server from your tax settings and where this ${docKind === "invoice" ? "customer" : "vendor"} is, then added to this.`
              : `No tax is charged on this ${docKind}, and it will say why.`}
          </p>
        </div>
      )}

      {error && <p className="rounded-md bg-overdue-tint p-3 text-[13px] text-overdue">{error}</p>}

      <button type="submit" disabled={saving || chosen.length === 0} className={buttonPrimaryClass}>
        {saving ? copy.submitting : copy.submit}
      </button>
    </form>
  );
}
