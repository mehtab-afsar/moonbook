import { Document, Page, View, Text, Image } from "@react-pdf/renderer";
import { pdfStyles } from "@/lib/pdf/styles";

/**
 * The letterhead every document shares — a title bar, then a header grid of
 * logo | company identity | organisation identifiers, matching the shape of
 * a real printed tax invoice rather than an on-screen card.
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
  org,
  logoDataUri,
  children,
}: {
  title: string;
  /** The number/date print in the body, next to Bill To, the way a printed
   *  invoice puts them — not in the letterhead. */
  docNo: string;
  org: DocumentOrg;
  /** Only the organisation's own uploaded logo prints here; there is no
   *  placeholder mark when it has none, because a decorative shape is not
   *  the business's identity. */
  logoDataUri?: string | null;
  children: React.ReactNode;
}) {
  const taxLine = org.tax_id ? `${org.tax_id_kind ?? "Tax ID"}: ${org.tax_id}` : "";

  return (
    <Document title={`${title} ${docNo}`} author={org.legal_name}>
      <Page size="A4" style={pdfStyles.page}>
        <View style={pdfStyles.frame}>
          <View style={pdfStyles.titleBar}>
            <Text style={pdfStyles.titleBarText}>{title.toUpperCase()}</Text>
          </View>

          <View style={pdfStyles.headerGrid}>
            {logoDataUri && (
              <View style={pdfStyles.logoCell}>
                {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer's Image, not an HTML img; it has no alt prop. */}
                <Image src={logoDataUri} style={pdfStyles.logo} />
              </View>
            )}
            <View style={pdfStyles.companyCell}>
              <Text style={pdfStyles.orgName}>{org.legal_name}</Text>
              {org.address && <Text style={pdfStyles.orgMeta}>{org.address}</Text>}
            </View>
            {(taxLine || org.region_code) && (
              <View style={pdfStyles.metaCell}>
                {taxLine !== "" && (
                  <View style={org.region_code ? pdfStyles.metaRow : pdfStyles.metaRowLast}>
                    <Text style={pdfStyles.metaLabel}>{org.tax_id_kind ?? "Tax ID"}</Text>
                    <Text style={pdfStyles.metaValue}>{org.tax_id}</Text>
                  </View>
                )}
                {org.region_code && (
                  <View style={pdfStyles.metaRowLast}>
                    <Text style={pdfStyles.metaLabel}>State</Text>
                    <Text style={pdfStyles.metaValue}>{org.region_code}</Text>
                  </View>
                )}
              </View>
            )}
          </View>

          {children}
        </View>

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
