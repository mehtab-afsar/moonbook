import { buildGstr1B2b, GST_STATE_CODES, type Gstr1SourceInvoice } from "@/lib/tax/gstr1";

const invoice = (overrides: Partial<Gstr1SourceInvoice> = {}): Gstr1SourceInvoice => ({
  doc_no: "INV-2627-000001",
  doc_date: "2026-06-15",
  total_minor: 1180000, // ₹11,800.00
  counterparty_gstin: "29AAAAA0000A1Z5",
  counterparty_region_code: "KA",
  taxes: [
    { component_code: "CGST", rate_pct: 9, amount_minor: 90000, taxable_value_minor: 1000000 },
    { component_code: "SGST", rate_pct: 9, amount_minor: 90000, taxable_value_minor: 1000000 },
  ],
  ...overrides,
});

describe("gstr1", () => {
  it("groups invoices under their counterparty's GSTIN", () => {
    const r = buildGstr1B2b("29BBBBB0000B1Z1", "062026", [invoice(), invoice({ doc_no: "INV-2627-000002" })]);
    expect(r.gstin).toBe("29BBBBB0000B1Z1");
    expect(r.fp).toBe("062026");
    expect(r.b2b).toHaveLength(1);
    expect(r.b2b[0].ctin).toBe("29AAAAA0000A1Z5");
    expect(r.b2b[0].inv).toHaveLength(2);
  });

  it("converts minor units to rupees and DD-MM-YYYY date", () => {
    const r = buildGstr1B2b("29BBBBB0000B1Z1", "062026", [invoice()]);
    const inv = r.b2b[0].inv[0] as { inum: string; idt: string; val: number };
    expect(inv.inum).toBe("INV-2627-000001");
    expect(inv.idt).toBe("15-06-2026");
    expect(inv.val).toBe(11800);
  });

  it("merges a CGST/SGST pair into one itms entry at the FULL rate, not the half rate", () => {
    const r = buildGstr1B2b("29BBBBB0000B1Z1", "062026", [invoice()]);
    const inv = r.b2b[0].inv[0] as { itms: { itm_det: { rt: number; txval: number; camt: number; samt: number; iamt: number } }[] };
    expect(inv.itms).toHaveLength(1);
    expect(inv.itms[0].itm_det).toEqual({ txval: 10000, rt: 18, camt: 900, samt: 900, iamt: 0, csamt: 0 });
  });

  it("keeps two different rates on one invoice as two separate itms entries, low rate first", () => {
    const mixed = invoice({
      total_minor: 1640000,
      taxes: [
        { component_code: "CGST", rate_pct: 9, amount_minor: 45000, taxable_value_minor: 500000 },
        { component_code: "SGST", rate_pct: 9, amount_minor: 45000, taxable_value_minor: 500000 },
        { component_code: "CGST", rate_pct: 2.5, amount_minor: 25000, taxable_value_minor: 1000000 },
        { component_code: "SGST", rate_pct: 2.5, amount_minor: 25000, taxable_value_minor: 1000000 },
      ],
    });
    const r = buildGstr1B2b("29BBBBB0000B1Z1", "062026", [mixed]);
    const inv = r.b2b[0].inv[0] as { itms: { itm_det: { rt: number } }[] };
    expect(inv.itms.map((i) => i.itm_det.rt)).toEqual([5, 18]);
  });

  it("uses IGST directly as the full rate, unhalved", () => {
    const interstate = invoice({
      counterparty_region_code: "MH",
      taxes: [{ component_code: "IGST", rate_pct: 18, amount_minor: 180000, taxable_value_minor: 1000000 }],
    });
    const r = buildGstr1B2b("29BBBBB0000B1Z1", "062026", [interstate]);
    const inv = r.b2b[0].inv[0] as { pos: string; itms: { itm_det: { rt: number; iamt: number; camt: number; samt: number } }[] };
    expect(inv.pos).toBe(GST_STATE_CODES.MH);
    expect(inv.itms[0].itm_det).toEqual({ txval: 10000, rt: 18, camt: 0, samt: 0, iamt: 1800, csamt: 0 });
  });

  it("falls back to place-of-supply '00' for a party with no region code, rather than throwing", () => {
    const r = buildGstr1B2b("29BBBBB0000B1Z1", "062026", [invoice({ counterparty_region_code: null })]);
    expect((r.b2b[0].inv[0] as { pos: string }).pos).toBe("00");
  });
});
