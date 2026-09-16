import { View, Text } from "@react-pdf/renderer";
import { DocumentShell } from "@/lib/pdf/DocumentShell";
import { pdfStyles, colors } from "@/lib/pdf/styles";
import { formatMoney, type CurrencyCode } from "@/lib/money";
import type { DocumentSnapshot } from "@/lib/pdf/snapshot";

/**
 * ONE renderer for every document, every industry, every country.
 *
 * The three things that would normally force a per-customer template are all
 * driven by rows in the snapshot instead:
 *
 *   · the tax block  — iterates `taxes`, so India prints CGST + SGST or IGST,
 *                      the UK prints VAT, and an unregistered business prints
 *                      no tax section at all. No branches on country.
 *   · the line detail — iterates each line's `printable_details`, so a freight
 *                      invoice shows "Route: Pune → Nashik" and a recycler's
 *                      shows "Material: PET · Net weight: 2,400 kg", from the
 *                      same JSX.
 *   · money + dates  — formatted with the organisation's own currency and
 *                      locale, so ₹12,34,567.00 and £1,234,567.00 both come
 *                      out grouped the way their reader expects.
 *
 * If this file ever needs an `if (country === …)`, the abstraction has failed.
 */

const TITLES: Record<string, string> = {
  invoice: "Tax Invoice",
  bill: "Purchase Bill",
  credit_note: "Credit Note",
  debit_note: "Debit Note",
};

export function DocumentPdf({ snapshot }: { snapshot: DocumentSnapshot }) {
  const { document: doc, lines, taxes, counterparty, ship_to, organisation } = snapshot;
  const currency = doc.currency as CurrencyCode;
  const locale = organisation.locale || "en";
  // `code`, not `symbol`: see MoneyDisplay in lib/money.ts — the PDF base
  // fonts have no ₹ glyph, and a broken box in place of the total is worse
  // than naming the currency.
  const money = (minor: number) => formatMoney(minor, currency, locale, { display: "code" });

  // An org that never registered for tax has no tax line to print; a document
  // marked exempt or reverse-charge has none either, and says why instead.
  const hasTax = taxes.length > 0;
  const treatmentNote =
    doc.tax_treatment === "reverse_charge"
      ? "Tax payable by the recipient under reverse charge."
      : doc.tax_treatment === "exempt"
        ? "Exempt / nil-rated — no tax charged."
        : null;

  // A line carrying a quantity gets the quantity columns; a flat-priced one
  // leaves them blank rather than printing a misleading "1".
  const showQuantity = lines.some((l) => l.quantity !== null && l.quantity !== undefined);
  const showDiscount = lines.some((l) => l.discount_minor > 0);

  return (
    <DocumentShell
      title={TITLES[doc.doc_kind] ?? "Document"}
      docNo={doc.doc_no ?? doc.party_doc_no ?? "—"}
      docDate={formatDate(doc.doc_date, locale)}
      org={organisation}
    >
      <View style={pdfStyles.sectionRow}>
        <View style={pdfStyles.block}>
          <Text style={pdfStyles.blockLabel}>
            {doc.direction === "payable" ? "Supplier" : "Bill to"}
          </Text>
          <Text style={pdfStyles.blockTitle}>{counterparty.name}</Text>
          {counterparty.address && <Text style={pdfStyles.blockMeta}>{counterparty.address}</Text>}
          {counterparty.tax_id && (
            <Text style={pdfStyles.blockMeta}>
              {counterparty.tax_id_kind ?? "Tax ID"} {counterparty.tax_id}
            </Text>
          )}
          {counterparty.region_code && (
            <Text style={pdfStyles.blockMeta}>Place of supply: {counterparty.region_code}</Text>
          )}
        </View>

        {ship_to && (
          <View style={pdfStyles.block}>
            <Text style={pdfStyles.blockLabel}>Ship to</Text>
            <Text style={pdfStyles.blockTitle}>{ship_to.name}</Text>
            {ship_to.address && <Text style={pdfStyles.blockMeta}>{ship_to.address}</Text>}
          </View>
        )}

        <View style={pdfStyles.block}>
          <Text style={pdfStyles.blockLabel}>Details</Text>
          <Text style={pdfStyles.blockMeta}>Date: {formatDate(doc.doc_date, locale)}</Text>
          {doc.due_date && (
            <Text style={pdfStyles.blockMeta}>Due: {formatDate(doc.due_date, locale)}</Text>
          )}
          {doc.party_doc_no && doc.doc_no && (
            <Text style={pdfStyles.blockMeta}>Their ref: {doc.party_doc_no}</Text>
          )}
          {/* No "Currency:" line — every amount below names it, because the
              PDF formats with the ISO code rather than a symbol. */}
        </View>
      </View>

      <View style={pdfStyles.table}>
        <View style={pdfStyles.tableHeaderRow}>
          <Text style={[pdfStyles.th, { flex: 1 }]}>Description</Text>
          {showQuantity && <Text style={[pdfStyles.th, { width: 70, textAlign: "right" }]}>Qty</Text>}
          {showQuantity && <Text style={[pdfStyles.th, { width: 70, textAlign: "right" }]}>Rate</Text>}
          {showDiscount && (
            <Text style={[pdfStyles.th, { width: 70, textAlign: "right" }]}>Discount</Text>
          )}
          <Text style={[pdfStyles.th, { width: 80, textAlign: "right" }]}>Amount</Text>
        </View>

        {lines.map((line, i) => (
          <View key={i} style={pdfStyles.tableRow} wrap={false}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={pdfStyles.td}>{line.description}</Text>
              {line.hsn_sac && <Text style={pdfStyles.tdMeta}>HSN/SAC {line.hsn_sac}</Text>}
              {/* The descriptive body, frozen at issue. This is the only place
                  in the entire system where it is shown, and it is shown as
                  text that was resolved months ago, not read live. */}
              {line.printable_details.length > 0 && (
                <Text style={pdfStyles.tdMeta}>
                  {line.printable_details.map((d) => `${d.label}: ${d.value}`).join("  ·  ")}
                </Text>
              )}
            </View>
            {showQuantity && (
              <Text style={[pdfStyles.td, { width: 70, textAlign: "right" }]}>
                {line.quantity != null ? `${trimNumber(line.quantity)}${line.unit ? ` ${line.unit}` : ""}` : ""}
              </Text>
            )}
            {showQuantity && (
              <Text style={[pdfStyles.td, { width: 70, textAlign: "right" }]}>
                {line.rate_minor != null ? money(line.rate_minor) : ""}
              </Text>
            )}
            {showDiscount && (
              <Text style={[pdfStyles.td, { width: 70, textAlign: "right" }]}>
                {line.discount_minor > 0 ? `− ${money(line.discount_minor)}` : ""}
              </Text>
            )}
            <Text style={[pdfStyles.td, { width: 80, textAlign: "right" }]}>
              {money(line.amount_minor)}
            </Text>
          </View>
        ))}
      </View>

      <View style={pdfStyles.totalsBlock}>
        <View style={pdfStyles.totalsRow}>
          <Text style={{ color: colors.ink2 }}>Taxable value</Text>
          <Text>{money(doc.taxable_value_minor)}</Text>
        </View>

        {/* Zero rows, one row or two — whatever the regime produced. */}
        {taxes
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((t, i) => (
            <View key={i} style={pdfStyles.totalsRow}>
              <Text style={{ color: colors.ink2 }}>{t.component_label}</Text>
              <Text>{money(t.amount_minor)}</Text>
            </View>
          ))}

        {doc.round_off_minor !== 0 && (
          <View style={pdfStyles.totalsRow}>
            <Text style={{ color: colors.ink2 }}>Round off</Text>
            <Text>{money(doc.round_off_minor)}</Text>
          </View>
        )}

        <View style={pdfStyles.totalsRowStrong}>
          <Text style={{ fontWeight: 700 }}>Total</Text>
          <Text style={{ fontWeight: 700 }}>{money(doc.total_minor)}</Text>
        </View>
      </View>

      {(treatmentNote || doc.notes || !hasTax) && (
        <View style={pdfStyles.noteBox}>
          {treatmentNote && <Text style={pdfStyles.note}>{treatmentNote}</Text>}
          {/* An org with no tax registration at all — distinct from an exempt
              supply by a registered one, which is why the note differs. */}
          {!hasTax && !treatmentNote && !organisation.tax_id && (
            <Text style={pdfStyles.note}>No tax charged — not registered for tax.</Text>
          )}
          {doc.notes && <Text style={pdfStyles.note}>{doc.notes}</Text>}
        </View>
      )}
    </DocumentShell>
  );
}

/** ISO date → the organisation's locale. Parsed as UTC so a date-only value
 *  cannot shift a day in a timezone behind Greenwich. */
function formatDate(iso: string, locale: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** 2400.00 → "2400"; 2.5 → "2.5". */
function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}
