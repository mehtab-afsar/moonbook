import { formatMoney } from "@/lib/money";

/**
 * Pairs with PartyCard on a receipt page — "here's who it's from, here's
 * where it's gone" as two cards side by side, the way LedgerFlow's receipt
 * detail splits "Received from" and "Applied" rather than folding the
 * unapplied figure into a trailing sentence.
 */
export function PaymentSummaryCard({
  totalMinor,
  appliedMinor,
  unappliedMinor,
  direction,
  currency,
  locale,
  /** "documents" in the shared ledger and plastics; logistics calls the same things "invoices". */
  noun = "documents",
}: {
  totalMinor: number;
  appliedMinor: number;
  unappliedMinor: number;
  direction: "in" | "out";
  currency: string;
  locale: string;
  noun?: string;
}) {
  const money = (minor: number) => formatMoney(minor, currency, locale);

  return (
    <section className="rounded-[10px] border border-line bg-white p-5">
      <h2 className="text-[13px] font-medium text-ink-2">Applied</h2>
      <dl className="mt-3 space-y-1.5 text-[13.5px]">
        <Row label="Total" value={money(totalMinor)} />
        <Row label={`Applied to ${noun}`} value={money(appliedMinor)} />
        <Row
          label={unappliedMinor > 0 ? "Unapplied — held as credit" : "Unapplied"}
          value={money(unappliedMinor)}
          strong
          tone={unappliedMinor > 0 ? "pending" : undefined}
        />
      </dl>
      {unappliedMinor > 0 && (
        <p className="mt-2 text-[12px] text-ink-3">
          {direction === "in" ? "Held as credit against a future invoice." : "Held as an advance against a future bill."}
        </p>
      )}
    </section>
  );
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "pending";
}) {
  const toneClass = tone === "pending" ? "text-pending-ink" : "text-ink";
  return (
    <div className={`flex items-center justify-between ${strong ? "border-t border-line-soft pt-1.5" : ""}`}>
      <dt className="text-ink-2">{label}</dt>
      <dd className={`font-mono ${strong ? "font-semibold" : ""} ${toneClass}`}>{value}</dd>
    </div>
  );
}
