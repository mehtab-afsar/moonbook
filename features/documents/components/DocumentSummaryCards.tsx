import { formatMoney } from "@/lib/money";

/**
 * Tax breakdown and balance, as two side-by-side cards rather than one dl
 * buried in the line-items table's footer. Splitting them gives the balance
 * — the one figure a reader actually came here to check — its own visual
 * weight instead of reading as just the last line of a tax computation.
 */
export function DocumentSummaryCards({
  taxableValueMinor,
  taxes,
  totalMinor,
  paidMinor,
  balanceDueMinor,
  overdue,
  currency,
  locale,
}: {
  taxableValueMinor: number;
  taxes: { label: string; amount_minor: number }[];
  totalMinor: number;
  /** Already settled or credited against this document. */
  paidMinor: number;
  balanceDueMinor: number | null;
  overdue: boolean;
  currency: string;
  locale: string;
}) {
  const money = (minor: number) => formatMoney(minor, currency, locale);

  return (
    <div className="grid gap-4 min-[640px]:grid-cols-2">
      <section className="rounded-[10px] border border-line bg-white p-5">
        <h2 className="text-[13px] font-medium text-ink-2">Tax summary</h2>
        <dl className="mt-3 space-y-1.5 text-[13.5px]">
          <Row label="Taxable value" value={money(taxableValueMinor)} />
          {taxes.map((t, i) => (
            <Row key={i} label={t.label} value={money(t.amount_minor)} />
          ))}
          <Row label="Total" value={money(totalMinor)} strong />
        </dl>
      </section>

      <section className="rounded-[10px] border border-line bg-white p-5">
        <h2 className="text-[13px] font-medium text-ink-2">Balance</h2>
        <dl className="mt-3 space-y-1.5 text-[13.5px]">
          <Row label="Total" value={money(totalMinor)} />
          {paidMinor > 0 && <Row label="Paid / credited" value={money(paidMinor)} tone="settled" />}
          {balanceDueMinor !== null && (
            <Row
              label={overdue ? "Balance due — overdue" : "Balance due"}
              value={money(balanceDueMinor)}
              strong
              tone={balanceDueMinor <= 0 ? "settled" : overdue ? "overdue" : undefined}
            />
          )}
        </dl>
      </section>
    </div>
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
  tone?: "settled" | "overdue";
}) {
  const toneClass = tone === "overdue" ? "text-overdue" : tone === "settled" ? "text-settled-ink" : "text-ink";
  return (
    <div className={`flex items-center justify-between ${strong ? "border-t border-line-soft pt-1.5" : ""}`}>
      <dt className="text-ink-2">{label}</dt>
      <dd className={`font-mono ${strong ? "font-semibold" : ""} ${toneClass}`}>{value}</dd>
    </div>
  );
}
