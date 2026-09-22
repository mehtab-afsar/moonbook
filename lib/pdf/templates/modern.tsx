import { Document, Page, View, Text, Image } from "@react-pdf/renderer";
import { modernStyles, modernColors } from "@/lib/pdf/templates/modern-styles";
import { formatMoney, fromMinor, type CurrencyCode } from "@/lib/money";
import { amountInWords } from "@/lib/pdf/numberToWords";
import { TITLES, formatDate, trimNumber, formatIrnForPrint, type InvoiceTemplateProps } from "@/lib/pdf/templates/types";

/**
 * "Modern" — soft rounded cards and one accent colour instead of Classic's
 * fully-bordered grid. Same underlying data, same compliance fields (tax
 * breakdown, HSN/SAC, amount in words, signature line) — only the visual
 * language differs. See templates/classic.tsx for the field-by-field
 * rationale; it isn't repeated here since it applies identically.
 */
export function ModernTemplate({ snapshot, logoDataUri, balance, invoiceOptions, compliance }: InvoiceTemplateProps) {
  const { document: doc, lines, taxes, counterparty, ship_to, organisation } = snapshot;
  const currency = doc.currency as CurrencyCode;
  const locale = organisation.locale || "en";
  const money = (minor: number) => formatMoney(minor, currency, locale, { display: "code" });
  const showHsn = invoiceOptions?.showHsn ?? true;

  const hasTax = taxes.length > 0;
  const treatmentNote =
    doc.tax_treatment === "reverse_charge"
      ? "Tax payable by the recipient under reverse charge."
      : doc.tax_treatment === "exempt"
        ? "Exempt / nil-rated — no tax charged."
        : null;

  const showQuantity = lines.some((l) => l.quantity !== null && l.quantity !== undefined);
  const showDiscount = lines.some((l) => l.discount_minor > 0);
  const title = TITLES[doc.doc_kind] ?? "Document";
  const docNo = doc.doc_no ?? doc.party_doc_no ?? "—";

  return (
    <Document title={`${title} ${docNo}`} author={organisation.legal_name}>
      <Page size="A4" style={modernStyles.page}>
        <View style={modernStyles.headerRow}>
          <View>
            {logoDataUri && (
              // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer's Image has no alt prop.
              <Image src={logoDataUri} style={modernStyles.logo} />
            )}
            <Text style={modernStyles.orgName}>{organisation.legal_name}</Text>
            {organisation.address && <Text style={modernStyles.orgMeta}>{organisation.address}</Text>}
            {organisation.tax_id && (
              <Text style={modernStyles.orgMeta}>
                {organisation.tax_id_kind ?? "Tax ID"}: {organisation.tax_id}
                {organisation.region_code ? `  ·  State: ${organisation.region_code}` : ""}
              </Text>
            )}
          </View>
          <View style={modernStyles.titleBlock}>
            <Text style={modernStyles.titleText}>{title.toUpperCase()}</Text>
            <Text style={modernStyles.titleMeta}>Invoice no: {docNo}</Text>
            <Text style={modernStyles.titleMeta}>Date: {formatDate(doc.doc_date, locale)}</Text>
            {doc.due_date && <Text style={modernStyles.titleMeta}>Due: {formatDate(doc.due_date, locale)}</Text>}
            {compliance?.ewbNo && <Text style={modernStyles.titleMeta}>E-way bill: {compliance.ewbNo}</Text>}
            {compliance?.irn && <Text style={modernStyles.titleMeta}>IRN: {formatIrnForPrint(compliance.irn)}</Text>}
          </View>
        </View>

        <View style={modernStyles.cardRow}>
          <View style={modernStyles.card}>
            <Text style={modernStyles.cardLabel}>{doc.direction === "payable" ? "Supplier" : "Bill to"}</Text>
            <Text style={modernStyles.cardTitle}>{counterparty.name}</Text>
            {counterparty.address && <Text style={modernStyles.cardMeta}>{counterparty.address}</Text>}
            {counterparty.tax_id && (
              <Text style={modernStyles.cardMeta}>
                {counterparty.tax_id_kind ?? "Tax ID"} {counterparty.tax_id}
              </Text>
            )}
            {counterparty.region_code && (
              <Text style={modernStyles.cardMeta}>Place of supply: {counterparty.region_code}</Text>
            )}
          </View>

          {ship_to && (
            <View style={modernStyles.card}>
              <Text style={modernStyles.cardLabel}>Ship to</Text>
              <Text style={modernStyles.cardTitle}>{ship_to.name}</Text>
              {ship_to.address && <Text style={modernStyles.cardMeta}>{ship_to.address}</Text>}
            </View>
          )}
        </View>

        <View style={modernStyles.table}>
          <View style={modernStyles.tableHeaderRow}>
            <Text style={[modernStyles.th, { flex: 1 }]}>Description</Text>
            {showQuantity && <Text style={[modernStyles.th, { width: 70, textAlign: "right" }]}>Qty</Text>}
            {showQuantity && <Text style={[modernStyles.th, { width: 70, textAlign: "right" }]}>Rate</Text>}
            {showDiscount && <Text style={[modernStyles.th, { width: 70, textAlign: "right" }]}>Discount</Text>}
            <Text style={[modernStyles.th, { width: 80, textAlign: "right" }]}>Amount</Text>
          </View>

          {lines.map((line, i) => (
            <View key={i} style={modernStyles.tableRow} wrap={false}>
              <View style={[modernStyles.td, { flex: 1 }]}>
                <Text>{line.description}</Text>
                {showHsn && line.hsn_sac && <Text style={modernStyles.tdMeta}>HSN/SAC {line.hsn_sac}</Text>}
                {line.printable_details.length > 0 && (
                  <Text style={modernStyles.tdMeta}>
                    {line.printable_details.map((d) => `${d.label}: ${d.value}`).join("  ·  ")}
                  </Text>
                )}
              </View>
              {showQuantity && (
                <Text style={[modernStyles.td, { width: 70, textAlign: "right" }]}>
                  {line.quantity != null ? `${trimNumber(line.quantity)}${line.unit ? ` ${line.unit}` : ""}` : ""}
                </Text>
              )}
              {showQuantity && (
                <Text style={[modernStyles.td, { width: 70, textAlign: "right" }]}>
                  {line.rate_minor != null ? money(line.rate_minor) : ""}
                </Text>
              )}
              {showDiscount && (
                <Text style={[modernStyles.td, { width: 70, textAlign: "right" }]}>
                  {line.discount_minor > 0 ? `− ${money(line.discount_minor)}` : ""}
                </Text>
              )}
              <Text style={[modernStyles.td, { width: 80, textAlign: "right" }]}>{money(line.amount_minor)}</Text>
            </View>
          ))}
        </View>

        <View style={modernStyles.totalsWrap}>
          <View style={modernStyles.totalsCard}>
            <View style={modernStyles.totalsRow}>
              <Text style={modernStyles.totalsLabel}>Taxable value</Text>
              <Text style={modernStyles.totalsValue}>{money(doc.taxable_value_minor)}</Text>
            </View>
            {taxes
              .slice()
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((t, i) => (
                <View key={i} style={modernStyles.totalsRow}>
                  <Text style={modernStyles.totalsLabel}>{t.component_label}</Text>
                  <Text style={modernStyles.totalsValue}>{money(t.amount_minor)}</Text>
                </View>
              ))}
            {doc.round_off_minor !== 0 && (
              <View style={modernStyles.totalsRow}>
                <Text style={modernStyles.totalsLabel}>Round off</Text>
                <Text style={modernStyles.totalsValue}>{money(doc.round_off_minor)}</Text>
              </View>
            )}
            <View style={modernStyles.totalsDivider} />
            <View style={modernStyles.totalsRowStrong}>
              <Text style={modernStyles.totalsLabelStrong}>Total</Text>
              <Text style={modernStyles.totalsValueStrong}>{money(doc.total_minor)}</Text>
            </View>
            {balance && balance.settledMinor > 0 && (
              <>
                <View style={modernStyles.totalsRow}>
                  <Text style={modernStyles.totalsLabel}>Paid</Text>
                  <Text style={modernStyles.totalsValue}>− {money(balance.settledMinor)}</Text>
                </View>
                <View style={modernStyles.totalsDivider} />
                <View style={modernStyles.totalsRowStrong}>
                  <Text style={modernStyles.totalsLabelStrong}>Balance due</Text>
                  <Text
                    style={[
                      modernStyles.totalsValueStrong,
                      { color: balance.balanceDueMinor > 0 ? modernColors.overdue : modernColors.settled },
                    ]}
                  >
                    {money(balance.balanceDueMinor)}
                  </Text>
                </View>
              </>
            )}
          </View>
        </View>

        <View style={modernStyles.wordsBox}>
          <Text style={modernStyles.wordsLabel}>Amount chargeable (in words)</Text>
          <Text style={modernStyles.wordsValue}>{amountInWords(fromMinor(doc.total_minor, currency), currency)}</Text>
        </View>

        {(treatmentNote || doc.notes || !hasTax) && (
          <View>
            {treatmentNote && <Text style={modernStyles.note}>{treatmentNote}</Text>}
            {!hasTax && !treatmentNote && !organisation.tax_id && (
              <Text style={modernStyles.note}>No tax charged — not registered for tax.</Text>
            )}
            {doc.notes && <Text style={modernStyles.note}>{doc.notes}</Text>}
          </View>
        )}

        {invoiceOptions?.terms && (
          <View>
            <Text style={modernStyles.cardLabel}>Terms &amp; Conditions</Text>
            <Text style={modernStyles.note}>{invoiceOptions.terms}</Text>
          </View>
        )}

        <View style={modernStyles.footerRow}>
          <Text style={modernStyles.footerNote}>
            Computer-generated document. Every figure above is computed server-side from this
            organisation&apos;s tax regime and the customer&apos;s region — no total here is a browser&apos;s opinion.
            Certified that the particulars given above are true and correct.
          </Text>
          <View style={modernStyles.signatureBlock}>
            <Text style={modernStyles.forCompany}>For {organisation.legal_name}</Text>
            <View style={modernStyles.signatureLine}>
              <Text style={modernStyles.signatureCaption}>Authorised Signatory</Text>
            </View>
          </View>
        </View>

        <Text
          style={modernStyles.pageFooter}
          render={({ pageNumber, totalPages }) => `${organisation.legal_name} · Page ${pageNumber} of ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}
