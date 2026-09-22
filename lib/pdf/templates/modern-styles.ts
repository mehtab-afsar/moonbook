import { StyleSheet } from "@react-pdf/renderer";

/**
 * "Modern" — soft cards, rounded corners, one accent colour, generous
 * whitespace. A deliberately different visual language from Classic's
 * fully-bordered grid, kept in its own file so the two templates can never
 * accidentally leak styling into each other.
 */
export const modernColors = {
  ink: "#171a2e",
  ink2: "#3c415c",
  ink3: "#8489a6",
  line: "#e7e9f2",
  paper: "#fbfbfd",
  accent: "#4c5fd7",
  accentTint: "#eef0fd",
  settled: "#16794a",
  overdue: "#b42318",
};

export const modernStyles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, color: modernColors.ink, fontFamily: "Helvetica" },

  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 },
  logo: { width: 44, height: 44, objectFit: "contain", borderRadius: 8, marginBottom: 8 },
  orgName: { fontSize: 14, fontWeight: 700, marginBottom: 3 },
  orgMeta: { fontSize: 8, color: modernColors.ink3, lineHeight: 1.5 },

  titleBlock: { alignItems: "flex-end" },
  titleText: { fontSize: 20, fontWeight: 700, color: modernColors.accent, letterSpacing: 0.5, marginBottom: 6 },
  titleMeta: { fontSize: 8.5, color: modernColors.ink2, textAlign: "right", lineHeight: 1.6 },

  cardRow: { flexDirection: "row", gap: 12, marginBottom: 18 },
  card: {
    flex: 1,
    backgroundColor: modernColors.paper,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: modernColors.line,
    padding: 12,
  },
  cardLabel: {
    fontSize: 7.5,
    color: modernColors.ink3,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    fontWeight: 700,
    marginBottom: 6,
  },
  cardTitle: { fontSize: 11, fontWeight: 700, marginBottom: 3 },
  cardMeta: { fontSize: 8.5, color: modernColors.ink2, lineHeight: 1.55 },

  table: { marginBottom: 4 },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 1.4,
    borderBottomColor: modernColors.ink,
    paddingBottom: 6,
    marginBottom: 2,
  },
  th: { fontSize: 7.5, color: modernColors.ink3, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.75,
    borderBottomColor: modernColors.line,
    paddingVertical: 8,
  },
  td: { fontSize: 9 },
  tdMeta: { fontSize: 7.8, color: modernColors.ink3, marginTop: 3, lineHeight: 1.4 },

  totalsWrap: { flexDirection: "row", justifyContent: "flex-end", marginTop: 10, marginBottom: 18 },
  totalsCard: {
    width: 240,
    backgroundColor: modernColors.paper,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: modernColors.line,
    padding: 12,
  },
  totalsRow: { flexDirection: "row", alignItems: "center", paddingVertical: 3 },
  totalsLabel: { flex: 1, fontSize: 8.5, color: modernColors.ink3 },
  totalsValue: { fontSize: 8.5, color: modernColors.ink },
  totalsDivider: { borderTopWidth: 1, borderTopColor: modernColors.line, marginVertical: 6 },
  totalsRowStrong: { flexDirection: "row", alignItems: "center", paddingTop: 2 },
  totalsLabelStrong: { flex: 1, fontSize: 10.5, fontWeight: 700, color: modernColors.ink },
  totalsValueStrong: { fontSize: 12, fontWeight: 700, color: modernColors.accent },

  wordsBox: {
    backgroundColor: modernColors.accentTint,
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  wordsLabel: {
    fontSize: 7,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: modernColors.accent,
    marginBottom: 3,
  },
  wordsValue: { fontSize: 9, fontWeight: 700, color: modernColors.ink, lineHeight: 1.3 },

  note: { fontSize: 8.5, color: modernColors.ink3, lineHeight: 1.4, marginBottom: 14 },

  footerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 20 },
  footerNote: { flex: 1.4, fontSize: 7.8, color: modernColors.ink3, lineHeight: 1.4, paddingRight: 20 },
  signatureBlock: { alignItems: "flex-end" },
  forCompany: { fontSize: 8.5, fontWeight: 700, marginBottom: 32 },
  signatureLine: { width: 150, borderTopWidth: 1, borderTopColor: modernColors.ink3, paddingTop: 4 },
  signatureCaption: { fontSize: 7.5, color: modernColors.ink3, textAlign: "right" },

  pageFooter: {
    position: "absolute",
    bottom: 18,
    left: 32,
    right: 32,
    fontSize: 7.5,
    color: modernColors.ink3,
    textAlign: "center",
  },
});
