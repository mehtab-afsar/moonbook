import { StyleSheet } from "@react-pdf/renderer";

/**
 * Hex mirrors of the tokens in app/globals.css — @react-pdf/renderer cannot
 * read CSS custom properties, so the palette is restated here to keep every
 * PDF visually part of the same family as the web app.
 *
 * PDFs are English-only: @react-pdf ships no HarfBuzz, so complex scripts
 * (Devanagari, Arabic) render as broken glyphs rather than failing loudly.
 * Localisation lives in the web UI until a real font pipeline exists.
 */
export const colors = {
  paper: "#f7f8fb",
  ink: "#171a2e",
  ink2: "#3c415c",
  ink3: "#6b7091",
  line: "#e0e2ec",
  lineSoft: "#eef0f6",
  brand: "#4c5fd7",
  brandTint: "#eaecfd",
  settled: "#16794a",
  overdue: "#b42318",
  headerFill: "#f2f2f2",
};

/**
 * The classic printed tax-invoice grid: one outer ruled frame, every section
 * inside it closed off by a shared border rather than its own card, square
 * corners throughout, no colour fill beyond the header/total bands. Modelled
 * directly on a real GST invoice, not a dashboard screenshot — that is
 * deliberate, and is the whole point of this file.
 */
export const pdfStyles = StyleSheet.create({
  page: { padding: 28, fontSize: 9, color: colors.ink, fontFamily: "Helvetica" },
  frame: { borderWidth: 1.2, borderColor: colors.ink },

  titleBar: {
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
    paddingVertical: 8,
  },
  titleBarText: {
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: 1.5,
    textAlign: "center",
  },

  // ─── Header grid: logo + company | org identifiers ─────────────────────
  headerGrid: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
  },
  logoCell: {
    width: 60,
    borderRightWidth: 1,
    borderRightColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  logo: { width: 40, height: 40, objectFit: "contain" },
  companyCell: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: colors.ink,
    padding: 10,
    justifyContent: "center",
  },
  orgName: { fontSize: 12.5, fontWeight: 700, marginBottom: 3 },
  orgMeta: { fontSize: 8, color: colors.ink2, lineHeight: 1.45 },
  metaCell: { width: 190 },
  metaRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
  },
  metaRowLast: { flexDirection: "row" },
  metaLabel: {
    width: "42%",
    borderRightWidth: 1,
    borderRightColor: colors.ink,
    padding: 5,
    fontSize: 7,
    fontWeight: 700,
    color: colors.ink2,
    textTransform: "uppercase",
  },
  metaValue: { flex: 1, padding: 5, fontSize: 8 },

  // ─── Bill to | Invoice meta ─────────────────────────────────────────────
  sectionRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.ink },
  block: { flex: 1, padding: 12, borderRightWidth: 1, borderRightColor: colors.ink },
  blockLabel: {
    fontSize: 7.5,
    color: colors.ink2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontWeight: 700,
    marginBottom: 5,
  },
  blockTitle: { fontSize: 11, fontWeight: 700, marginBottom: 3 },
  blockMeta: { fontSize: 8.5, color: colors.ink2, lineHeight: 1.5 },

  // ─── Line items ──────────────────────────────────────────────────────────
  table: { borderBottomWidth: 1, borderBottomColor: colors.ink },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: colors.headerFill,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  th: {
    padding: 6,
    fontSize: 7.5,
    color: colors.ink,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    borderRightWidth: 1,
    borderRightColor: colors.ink,
  },
  td: { padding: 6, fontSize: 9, borderRightWidth: 1, borderRightColor: colors.line },
  thLast: { borderRightWidth: 0 },
  tdLast: { borderRightWidth: 0 },
  tdMeta: { fontSize: 7.8, color: colors.ink2, marginTop: 3, lineHeight: 1.4 },
  sNo: { width: 24, textAlign: "center" },

  /** A totals line as one more row of the SAME table — label spans every
   *  column but the last, value sits under Amount — not a separate box
   *  floating off to the side. */
  totalsRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  totalsLabel: { flex: 1, fontSize: 8.5, color: colors.ink2, textAlign: "right", paddingRight: 14 },
  totalsValue: { width: 80, fontSize: 8.5, textAlign: "right" },
  totalsRowStrong: {
    flexDirection: "row",
    alignItems: "center",
    padding: 7,
    backgroundColor: colors.headerFill,
  },
  totalsLabelStrong: { flex: 1, fontSize: 9.5, fontWeight: 700, textAlign: "right", paddingRight: 14 },
  totalsValueStrong: { width: 80, fontSize: 9.5, fontWeight: 700, textAlign: "right" },

  // ─── Amount in words ─────────────────────────────────────────────────────
  wordsBox: {
    padding: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
  },
  wordsLabel: {
    fontSize: 7,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: colors.ink2,
    marginBottom: 3,
  },
  wordsValue: { fontSize: 9, fontWeight: 700, lineHeight: 1.3 },

  note: { fontSize: 8.5, color: colors.ink2, lineHeight: 1.4 },
  noteBox: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
  },

  // ─── Certification + signature ──────────────────────────────────────────
  certRow: { flexDirection: "row" },
  certLeft: { flex: 1.4, padding: 10, borderRightWidth: 1, borderRightColor: colors.ink },
  certRight: { flex: 1, padding: 10 },
  certText: { fontSize: 7.8, color: colors.ink2, lineHeight: 1.4 },
  forCompany: { fontSize: 8.5, fontWeight: 700, marginTop: 6 },
  signatureLine: { marginTop: 34, borderTopWidth: 1, borderTopColor: colors.ink, paddingTop: 4, alignItems: "flex-end" },
  signatureCaption: { fontSize: 7.5, color: colors.ink2, textAlign: "right" },

  footer: {
    position: "absolute",
    bottom: 16,
    left: 28,
    right: 28,
    fontSize: 7.5,
    color: colors.ink3,
    textAlign: "center",
  },
});
