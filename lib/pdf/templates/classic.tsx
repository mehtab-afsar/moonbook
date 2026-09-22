import { View, Text } from "@react-pdf/renderer";
import { DocumentShell } from "@/lib/pdf/DocumentShell";
import { pdfStyles, colors } from "@/lib/pdf/styles";
import { formatMoney, fromMinor, type CurrencyCode } from "@/lib/money";
import { amountInWords } from "@/lib/pdf/numberToWords";
import { TITLES, formatDate, trimNumber, formatIrnForPrint, type InvoiceTemplateProps } from "@/lib/pdf/templates/types";

/**
 * "Classic" — the dense, fully-bordered printed tax-invoice grid: one outer
 * ruled frame, every section closed off by a shared border rather than its
 * own card, square corners throughout, no colour fill beyond the header/
 * total bands. Modelled directly on a real GST invoice.
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
export function ClassicTemplate({ snapshot, logoDataUri, balance, invoiceOptions, compliance }: InvoiceTemplateProps) {
  const { document: doc, lines, taxes, counterparty, ship_to, organisation } = snapshot;
  const currency = doc.currency as CurrencyCode;
  const locale = organisation.locale || "en";
  // Undefined (caller hasn't loaded org settings yet) behaves exactly like
  // today: HSN/SAC shows whenever a line has one.
  const showHsn = invoiceOptions?.showHsn ?? true;
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
      logoDataUri={logoDataUri}
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

        <View style={[pdfStyles.block, { borderRightWidth: 0 }]}>
          <Text style={pdfStyles.blockLabel}>Details</Text>
          <Text style={pdfStyles.blockMeta}>Invoice no: {doc.doc_no ?? "—"}</Text>
          <Text style={pdfStyles.blockMeta}>Date: {formatDate(doc.doc_date, locale)}</Text>
          {doc.due_date && (
            <Text style={pdfStyles.blockMeta}>Due: {formatDate(doc.due_date, locale)}</Text>
          )}
          {doc.party_doc_no && doc.doc_no && (
            <Text style={pdfStyles.blockMeta}>Their ref: {doc.party_doc_no}</Text>
          )}
          {compliance?.ewbNo && (
            <Text style={pdfStyles.blockMeta}>E-way bill: {compliance.ewbNo}</Text>
          )}
          {compliance?.irn && (
            <Text style={pdfStyles.blockMeta}>IRN: {formatIrnForPrint(compliance.irn)}</Text>
          )}
        </View>
      </View>

      <View style={pdfStyles.table}>
        <View style={pdfStyles.tableHeaderRow}>
          <Text style={[pdfStyles.th, pdfStyles.sNo]}>#</Text>
          <Text style={[pdfStyles.th, { flex: 1 }]}>Description</Text>
          {showQuantity && <Text style={[pdfStyles.th, { width: 70, textAlign: "right" }]}>Qty</Text>}
          {showQuantity && <Text style={[pdfStyles.th, { width: 70, textAlign: "right" }]}>Rate</Text>}
          {showDiscount && (
            <Text style={[pdfStyles.th, { width: 70, textAlign: "right" }]}>Discount</Text>
          )}
          <Text style={[pdfStyles.th, pdfStyles.thLast, { width: 80, textAlign: "right" }]}>Amount</Text>
        </View>

        {lines.map((line, i) => (
          <View key={i} style={pdfStyles.tableRow} wrap={false}>
            <Text style={[pdfStyles.td, pdfStyles.sNo]}>{i + 1}</Text>
            <View style={[pdfStyles.td, { flex: 1 }]}>
              <Text>{line.description}</Text>
              {showHsn && line.hsn_sac && <Text style={pdfStyles.tdMeta}>HSN/SAC {line.hsn_sac}</Text>}
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
            <Text style={[pdfStyles.td, pdfStyles.tdLast, { width: 80, textAlign: "right" }]}>
              {money(line.amount_minor)}
            </Text>
          </View>
        ))}

        {/* Totals continue the same table — the label spans everything to
            the left of Amount, the value sits under it, the way a printed
            invoice's own "Total" row does, not a box floating to the side. */}
        <View style={pdfStyles.totalsRow}>
          <Text style={pdfStyles.totalsLabel}>Taxable value</Text>
          <Text style={pdfStyles.totalsValue}>{money(doc.taxable_value_minor)}</Text>
        </View>

        {taxes
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((t, i) => (
            <View key={i} style={pdfStyles.totalsRow}>
              <Text style={pdfStyles.totalsLabel}>{t.component_label}</Text>
              <Text style={pdfStyles.totalsValue}>{money(t.amount_minor)}</Text>
            </View>
          ))}

        {doc.round_off_minor !== 0 && (
          <View style={pdfStyles.totalsRow}>
            <Text style={pdfStyles.totalsLabel}>Round off</Text>
            <Text style={pdfStyles.totalsValue}>{money(doc.round_off_minor)}</Text>
          </View>
        )}

        <View style={pdfStyles.totalsRowStrong}>
          <Text style={pdfStyles.totalsLabelStrong}>Total</Text>
          <Text style={pdfStyles.totalsValueStrong}>{money(doc.total_minor)}</Text>
        </View>

        {balance && balance.settledMinor > 0 && (
          <>
            <View style={pdfStyles.totalsRow}>
              <Text style={pdfStyles.totalsLabel}>Paid</Text>
              <Text style={pdfStyles.totalsValue}>− {money(balance.settledMinor)}</Text>
            </View>
            <View style={pdfStyles.totalsRowStrong}>
              <Text style={pdfStyles.totalsLabelStrong}>Balance due</Text>
              <Text
                style={[
                  pdfStyles.totalsValueStrong,
                  { color: balance.balanceDueMinor > 0 ? colors.overdue : colors.settled },
                ]}
              >
                {money(balance.balanceDueMinor)}
              </Text>
            </View>
          </>
        )}
      </View>

      <View style={pdfStyles.wordsBox}>
        <Text style={pdfStyles.wordsLabel}>Amount chargeable (in words)</Text>
        <Text style={pdfStyles.wordsValue}>{amountInWords(fromMinor(doc.total_minor, currency), currency)}</Text>
      </View>

      {(treatmentNote || doc.notes || !hasTax) && (
        <View style={pdfStyles.noteBox}>
          {treatmentNote && <Text style={pdfStyles.note}>{treatmentNote}</Text>}
          {!hasTax && !treatmentNote && !organisation.tax_id && (
            <Text style={pdfStyles.note}>No tax charged — not registered for tax.</Text>
          )}
          {doc.notes && <Text style={pdfStyles.note}>{doc.notes}</Text>}
        </View>
      )}

      {invoiceOptions?.terms && (
        <View style={pdfStyles.noteBox}>
          <Text style={pdfStyles.blockLabel}>Terms &amp; Conditions</Text>
          <Text style={pdfStyles.note}>{invoiceOptions.terms}</Text>
        </View>
      )}

      <View style={pdfStyles.certRow}>
        <View style={pdfStyles.certLeft}>
          <Text style={pdfStyles.certText}>
            Computer-generated document. Every figure above is computed server-side from
            this organisation&apos;s tax regime and the customer&apos;s region — no total here
            is a browser&apos;s opinion.
          </Text>
        </View>
        <View style={pdfStyles.certRight}>
          <Text style={pdfStyles.certText}>Certified that the particulars given above are true and correct.</Text>
          <Text style={pdfStyles.forCompany}>For {organisation.legal_name}</Text>
          <View style={pdfStyles.signatureLine}>
            <Text style={pdfStyles.signatureCaption}>Authorised Signatory</Text>
          </View>
        </View>
      </View>
    </DocumentShell>
  );
}
