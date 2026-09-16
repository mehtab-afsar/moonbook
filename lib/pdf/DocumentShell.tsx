import { Document, Page, View, Text } from "@react-pdf/renderer";
import { pdfStyles } from "@/lib/pdf/styles";

/**
 * The letterhead every document shares.
 *
 * Note what is NOT here: no GSTIN field, no state code, no country-specific
 * anything. The organisation carries a `tax_id` and a `tax_id_kind`, and the
 * header prints whichever it has — "GSTIN 29AA…" for an Indian org, "VAT
 * GB123…" for a British one, and nothing at all for an unregistered business.
 * That is the whole multi-country story in one line of JSX.
 */
export interface DocumentOrg {
  legal_name: string;
  /** Nullish rather than nullable: these come from a parsed snapshot where an
   *  absent key and an explicit null mean the same thing — not registered. */
  tax_id?: string | null;
  tax_id_kind?: string | null;
  region_code?: string | null;
  address?: string | null;
}

export function DocumentShell({
  title,
  docNo,
  docDate,
  org,
  children,
}: {
  title: string;
  docNo: string;
  docDate: string;
  org: DocumentOrg;
  children: React.ReactNode;
}) {
  const taxLine = org.tax_id ? `${org.tax_id_kind ?? "Tax ID"} ${org.tax_id}` : "";

  return (
    <Document title={`${title} ${docNo}`} author={org.legal_name}>
      <Page size="A4" style={pdfStyles.page}>
        <View style={pdfStyles.headerRow}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={pdfStyles.mark} />
            <View>
              <Text style={pdfStyles.orgName}>{org.legal_name}</Text>
              {taxLine !== "" && (
                <Text style={pdfStyles.orgMeta}>
                  {taxLine}
                  {org.region_code ? `  ·  ${org.region_code}` : ""}
                </Text>
              )}
              {org.address && <Text style={pdfStyles.orgMeta}>{org.address}</Text>}
            </View>
          </View>
          <View>
            <Text style={pdfStyles.title}>{title}</Text>
            <Text style={pdfStyles.docMeta}>{docNo}</Text>
            <Text style={pdfStyles.docMeta}>{docDate}</Text>
          </View>
        </View>

        {children}

        <Text
          style={pdfStyles.footer}
          render={({ pageNumber, totalPages }) =>
            `${org.legal_name} · Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
