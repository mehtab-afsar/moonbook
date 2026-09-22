"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, FileText } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { buttonPrimaryClass, searchInputClass } from "@/lib/ui/styles";
import { ReceiptForm, type OpenDocument } from "./ReceiptForm";
import type { PartyRole } from "@/lib/parties/roles";

const METHOD_LABEL: Record<string, string> = {
  bank: "Bank transfer",
  cash: "Cash",
  cheque: "Cheque",
  card: "Card",
  online: "Online",
};

export interface PaymentRow {
  id: string;
  paid_on: string;
  method: string;
  reference_no: string | null;
  currency: string;
  amount_minor: number;
  party_name: string | null;
}

export function ReceiptsPanel({
  heading,
  title,
  description,
  addLabel,
  parties,
  openByParty,
  rows,
  unappliedById,
  locale,
  today,
  direction,
  defaultCurrency,
  partyColumn,
  emptyLabel,
  pdfHrefPrefix,
  formOverride,
}: {
  heading: "h1" | "h2";
  title: string;
  description: string;
  addLabel: string;
  parties: { id: string; name: string; role?: PartyRole; kind?: "client" | "vendor" | null }[];
  openByParty: Record<string, OpenDocument[]>;
  rows: PaymentRow[];
  unappliedById: Map<string, number>;
  locale: string;
  today: string;
  direction: "in" | "out";
  defaultCurrency: string;
  partyColumn: string;
  emptyLabel: string;
  /** e.g. "/api/logistics/payments" — the row's PDF opens at `${pdfHrefPrefix}/${id}/pdf`, in a new tab. */
  pdfHrefPrefix?: string;
  /** Swaps the plain ReceiptForm for something richer — logistics vendor
   *  payments use this to get VendorPaymentForm's service-linking and
   *  "new charge from this vendor" flow instead of a bare amount+party form. */
  formOverride?: (onDone: () => void) => React.ReactNode;
}) {
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) =>
      [p.party_name, p.reference_no, METHOD_LABEL[p.method] ?? p.method]
        .filter((v): v is string => Boolean(v))
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const Heading = heading;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Heading
            className={
              heading === "h1"
                ? "text-[22px] font-semibold tracking-[-0.01em] text-ink"
                : "text-[18px] font-semibold tracking-[-0.01em] text-ink"
            }
          >
            {title}
          </Heading>
          <p className="mt-1 text-[13.5px] text-ink-2">{description}</p>
        </div>
        <button type="button" onClick={() => setShowForm((s) => !s)} className={buttonPrimaryClass}>
          {showForm ? "Cancel" : addLabel}
        </button>
      </header>

      {showForm &&
        (formOverride ? (
          formOverride(() => setShowForm(false))
        ) : (
          <ReceiptForm
            parties={parties}
            openByParty={openByParty}
            locale={locale}
            today={today}
            direction={direction}
            defaultCurrency={defaultCurrency}
            onDone={() => setShowForm(false)}
          />
        ))}

      <div className="relative max-w-[360px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" strokeWidth={1.75} />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${title.toLowerCase()}…`}
          className={searchInputClass}
        />
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
        <table className="w-full text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-line-soft text-[12px] uppercase tracking-wide text-ink-3">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">{partyColumn}</th>
              <th className="px-5 py-3 font-medium">How</th>
              <th className="px-5 py-3 font-medium">Reference</th>
              <th className="px-5 py-3 font-medium">Amount</th>
              <th className="px-5 py-3 font-medium">Unapplied</th>
              {pdfHrefPrefix && <th className="px-5 py-3 font-medium"></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={pdfHrefPrefix ? 7 : 6} className="px-5 py-10 text-center text-ink-3">
                  {rows.length === 0 ? emptyLabel : "No matches for your search."}
                </td>
              </tr>
            )}
            {filtered.map((p) => {
              const unapplied = unappliedById.get(p.id) ?? 0;
              return (
                <tr key={p.id} className="border-b border-line-soft last:border-b-0">
                  <td className="px-5 py-3 font-mono text-ink-2">
                    <Link href={`/logistics/payments/${p.id}`} className="text-brand hover:underline">{p.paid_on}</Link>
                  </td>
                  <td className="px-5 py-3 font-medium text-ink">{p.party_name ?? "—"}</td>
                  <td className="px-5 py-3 text-ink-2">{METHOD_LABEL[p.method] ?? p.method}</td>
                  <td className="px-5 py-3 font-mono text-ink-2">{p.reference_no ?? "—"}</td>
                  <td className="px-5 py-3 font-mono text-ink">
                    {formatMoney(p.amount_minor, p.currency, locale)}
                  </td>
                  <td className="px-5 py-3 font-mono">
                    {unapplied > 0 ? (
                      <span className="text-pending-ink">{formatMoney(unapplied, p.currency, locale)}</span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                  {pdfHrefPrefix && (
                    <td className="px-5 py-3 text-right">
                      <a
                        href={`${pdfHrefPrefix}/${p.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        title="Open PDF"
                        className="inline-flex text-ink-3 hover:text-brand"
                      >
                        <FileText className="size-4" strokeWidth={1.75} />
                      </a>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
