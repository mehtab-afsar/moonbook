import { View, Text } from "@react-pdf/renderer";
import { DocumentShell, type DocumentOrg } from "@/lib/pdf/DocumentShell";
import { pdfStyles } from "@/lib/pdf/styles";
import { formatMoney, fromMinor, type CurrencyCode } from "@/lib/money";
import { amountInWords } from "@/lib/pdf/numberToWords";

export interface ReceiptSnapshot {
  id: string;
  direction: "in" | "out";
  paid_on: string;
  method: string;
  reference_no: string | null;
  currency: string;
  amount_minor: number;
  party: { name: string; tax_id: string | null; tax_id_kind: string | null; address: string | null };
  /** What this receipt has been applied to, oldest allocation first. */
  applications: { doc_no: string; doc_date: string; doc_total_minor: number; amount_minor: number }[];
  organisation: DocumentOrg & { locale: string };
}

const METHOD_LABEL: Record<string, string> = {
  bank: "Bank transfer", cash: "Cash", cheque: "Cheque", card: "Card", online: "Online",
};

/**
 * A payment, printed. No line items, no tax — money moving one direction,
 * optionally matched against one or more documents. Reuses the same
 * DocumentShell letterhead every invoice/bill uses, so a receipt looks like
 * it came from the same business, not a different tool bolted on.
 */
export function ReceiptPdf({ snapshot, logoDataUri }: { snapshot: ReceiptSnapshot; logoDataUri?: string | null }) {
  const currency = snapshot.currency as CurrencyCode;
  const locale = snapshot.organisation.locale || "en";
  const money = (minor: number) => formatMoney(minor, currency, locale, { display: "code" });

  const applied = snapshot.applications.reduce((s, a) => s + a.amount_minor, 0);
  const unapplied = snapshot.amount_minor - applied;

  // A receipt has no sequence of its own (see the note on why this is
  // deliberately not a numbered series) — it's named from its own id, which
  // is stable and unique, just not gapless-counted the way a document is.
  const receiptNo = `REC-${snapshot.id.slice(0, 8).toUpperCase()}`;

  return (
    <DocumentShell
      title={snapshot.direction === "in" ? "Payment Receipt" : "Payment Voucher"}
      docNo={receiptNo}
      docDate={formatDate(snapshot.paid_on, locale)}
      org={snapshot.organisation}
      logoDataUri={logoDataUri}
    >
      <View style={pdfStyles.sectionRow}>
        <View style={pdfStyles.block}>
          <Text style={pdfStyles.blockLabel}>
            {snapshot.direction === "in" ? "Received from" : "Paid to"}
          </Text>
          <Text style={pdfStyles.blockTitle}>{snapshot.party.name}</Text>
          {snapshot.party.address && <Text style={pdfStyles.blockMeta}>{snapshot.party.address}</Text>}
          {snapshot.party.tax_id && (
            <Text style={pdfStyles.blockMeta}>
              {snapshot.party.tax_id_kind ?? "Tax ID"} {snapshot.party.tax_id}
            </Text>
          )}
        </View>

        <View style={[pdfStyles.block, { borderRightWidth: 0 }]}>
          <Text style={pdfStyles.blockLabel}>Details</Text>
          <Text style={pdfStyles.blockMeta}>Date: {formatDate(snapshot.paid_on, locale)}</Text>
          <Text style={pdfStyles.blockMeta}>
            Mode: {METHOD_LABEL[snapshot.method] ?? snapshot.method}
            {snapshot.reference_no ? `  ·  Ref ${snapshot.reference_no}` : ""}
          </Text>
        </View>
      </View>

      <View style={pdfStyles.table}>
        {snapshot.applications.length > 0 && (
          <>
            <View style={pdfStyles.tableHeaderRow}>
              <Text style={[pdfStyles.th, { flex: 1 }]}>Applied to</Text>
              <Text style={[pdfStyles.th, { width: 80, textAlign: "right" }]}>Date</Text>
              <Text style={[pdfStyles.th, { width: 80, textAlign: "right" }]}>Doc. total</Text>
              <Text style={[pdfStyles.th, pdfStyles.thLast, { width: 80, textAlign: "right" }]}>Applied</Text>
            </View>
            {snapshot.applications.map((a, i) => (
              <View key={i} style={pdfStyles.tableRow} wrap={false}>
                <Text style={[pdfStyles.td, { flex: 1 }]}>{a.doc_no}</Text>
                <Text style={[pdfStyles.td, { width: 80, textAlign: "right" }]}>{formatDate(a.doc_date, locale)}</Text>
                <Text style={[pdfStyles.td, { width: 80, textAlign: "right" }]}>{money(a.doc_total_minor)}</Text>
                <Text style={[pdfStyles.td, pdfStyles.tdLast, { width: 80, textAlign: "right" }]}>{money(a.amount_minor)}</Text>
              </View>
            ))}
            <View style={pdfStyles.totalsRow}>
              <Text style={pdfStyles.totalsLabel}>Applied</Text>
              <Text style={pdfStyles.totalsValue}>{money(applied)}</Text>
            </View>
          </>
        )}
        {unapplied > 0 && (
          <View style={pdfStyles.totalsRow}>
            <Text style={pdfStyles.totalsLabel}>
              {snapshot.direction === "in" ? "Held as credit" : "Held as advance"}
            </Text>
            <Text style={pdfStyles.totalsValue}>{money(unapplied)}</Text>
          </View>
        )}
        <View style={pdfStyles.totalsRowStrong}>
          <Text style={pdfStyles.totalsLabelStrong}>
            {snapshot.direction === "in" ? "Amount received" : "Amount paid"}
          </Text>
          <Text style={pdfStyles.totalsValueStrong}>{money(snapshot.amount_minor)}</Text>
        </View>
      </View>

      <View style={pdfStyles.wordsBox}>
        <Text style={pdfStyles.wordsLabel}>Amount in words</Text>
        <Text style={pdfStyles.wordsValue}>{amountInWords(fromMinor(snapshot.amount_minor, currency), currency)}</Text>
      </View>

      {unapplied > 0 && (
        <View style={pdfStyles.noteBox}>
          <Text style={pdfStyles.note}>
            {snapshot.direction === "in"
              ? "This receipt is not fully matched to an invoice — the unapplied portion is held as credit against a future one."
              : "This payment is not fully matched to a bill — the unapplied portion is held as an advance against a future one."}
          </Text>
        </View>
      )}
    </DocumentShell>
  );
}

function formatDate(iso: string, locale: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}
