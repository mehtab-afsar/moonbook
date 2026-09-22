/**
 * GSTR-1's B2B section — the invoice-level detail GSTR-1/3B filing needs for
 * sales to OTHER REGISTERED businesses, shaped to match the field names the
 * GST portal's own offline tool expects (ctin, inum, idt, val, pos, itms,
 * itm_det.txval/rt/camt/samt/iamt). Deliberately not a filing tool: no
 * digital signature, no upload — this hands an accountant a file in the
 * shape they already know how to read, instead of a re-keyed spreadsheet.
 *
 * Deliberately B2B only, not the full GSTR-1 schema. B2CS/B2CL (unregistered
 * customers) aggregate differently — by state and rate, not by invoice — and
 * exports/credit notes have their own sections again. Each is a real,
 * separate piece of work; shipping B2B first is what actually unblocks "my
 * accountant has to re-key this" for the common case of billing other GST-
 * registered businesses, which is what prompted this in the first place.
 */

/** ISO 3166-2:IN state/UT code (as stored on parties.region_code) → the GST
 *  portal's own 2-digit numeric state code, used as `pos` (place of supply). */
export const GST_STATE_CODES: Record<string, string> = {
  JK: "01", HP: "02", PB: "03", CH: "04", UT: "05", HR: "06", DL: "07",
  RJ: "08", UP: "09", BR: "10", SK: "11", AR: "12", NL: "13", MN: "14",
  MZ: "15", TR: "16", ML: "17", AS: "18", WB: "19", JH: "20", OR: "21",
  CT: "22", MP: "23", GJ: "24", DN: "26", MH: "27", KA: "29", GA: "30",
  LD: "31", KL: "32", TN: "33", PY: "34", AN: "35", TG: "36", AP: "37",
  LA: "38",
};

export interface Gstr1TaxRow {
  component_code: string; // 'CGST' | 'SGST' | 'IGST'
  rate_pct: number; // the HALF rate for a CGST/SGST row, the full rate for IGST
  amount_minor: number;
  taxable_value_minor: number;
}

export interface Gstr1SourceInvoice {
  doc_no: string;
  doc_date: string; // ISO yyyy-mm-dd
  total_minor: number;
  counterparty_gstin: string;
  counterparty_region_code: string | null;
  taxes: Gstr1TaxRow[];
}

/** Minor units → rupees, as a plain number (GSTN's JSON uses decimal rupees, not paise). */
function toRupees(minor: number): number {
  return Math.round(minor) / 100;
}

/**
 * One invoice's line items, one entry per distinct rate. CGST+SGST rows that
 * share a taxable base are the two halves of ONE rate applied to ONE base —
 * grouped by (effective full rate, taxable value) so they merge into a
 * single itms[] entry the way a real GSTR-1 invoice does, rather than
 * printing as two separate "rates."
 */
function buildItems(taxes: Gstr1TaxRow[]) {
  const groups = new Map<string, { rt: number; txval: number; camt: number; samt: number; iamt: number }>();

  for (const t of taxes) {
    const fullRate = t.component_code === "CGST" || t.component_code === "SGST" ? t.rate_pct * 2 : t.rate_pct;
    const key = `${fullRate}|${t.taxable_value_minor}`;
    const g = groups.get(key) ?? { rt: fullRate, txval: toRupees(t.taxable_value_minor), camt: 0, samt: 0, iamt: 0 };
    if (t.component_code === "CGST") g.camt += toRupees(t.amount_minor);
    else if (t.component_code === "SGST") g.samt += toRupees(t.amount_minor);
    else if (t.component_code === "IGST") g.iamt += toRupees(t.amount_minor);
    groups.set(key, g);
  }

  return [...groups.values()]
    .sort((a, b) => a.rt - b.rt)
    .map((g, i) => ({
      num: i + 1,
      itm_det: { txval: g.txval, rt: g.rt, camt: g.camt, samt: g.samt, iamt: g.iamt, csamt: 0 },
    }));
}

export interface Gstr1B2b {
  gstin: string;
  fp: string; // MMYYYY
  b2b: { ctin: string; inv: unknown[] }[];
}

/**
 * `invoices` should already be filtered to issued invoices in the filing
 * period, billed to a counterparty that HAS a GSTIN — an unregistered
 * customer belongs in B2CS/B2CL, not here, and this function does not
 * decide that; the caller does, at the query.
 */
export function buildGstr1B2b(gstin: string, period: string, invoices: Gstr1SourceInvoice[]): Gstr1B2b {
  const byCtin = new Map<string, unknown[]>();

  for (const inv of invoices) {
    const list = byCtin.get(inv.counterparty_gstin) ?? [];
    list.push({
      inum: inv.doc_no,
      idt: formatDDMMYYYY(inv.doc_date),
      val: toRupees(inv.total_minor),
      pos: (inv.counterparty_region_code && GST_STATE_CODES[inv.counterparty_region_code.toUpperCase()]) || "00",
      rchrg: "N",
      inv_typ: "R",
      itms: buildItems(inv.taxes),
    });
    byCtin.set(inv.counterparty_gstin, list);
  }

  return {
    gstin,
    fp: period,
    b2b: [...byCtin.entries()].map(([ctin, inv]) => ({ ctin, inv })),
  };
}

function formatDDMMYYYY(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}
