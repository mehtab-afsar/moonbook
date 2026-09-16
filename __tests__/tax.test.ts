import { computeTax, REVERSE_CHARGE_NOTE, EXEMPT_NOTE, type TaxInput } from "@/lib/tax";

const base: TaxInput = {
  regime: "split_rate",
  treatment: "forward",
  taxableValueMinor: 1000000, // ₹10,000.00
  ratePct: 18,
  supplierRegion: "KA",
  placeOfSupplyRegion: "KA",
};

describe("tax", () => {
  describe("treatment is checked before the regime", () => {
    it("exempt carries no tax and says why", () => {
      const r = computeTax({ ...base, treatment: "exempt" });
      expect(r.components).toEqual([]);
      expect(r.totalTaxMinor).toBe(0);
      expect(r.totalMinor).toBe(1000000);
      expect(r.note).toBe(EXEMPT_NOTE);
    });

    it("reverse charge carries no tax and says why", () => {
      const r = computeTax({ ...base, treatment: "reverse_charge" });
      expect(r.components).toEqual([]);
      expect(r.note).toBe(REVERSE_CHARGE_NOTE);
    });

    it("an exempt supply under reverse charge reads as exempt, not reverse charge", () => {
      // Ordering matters: the recipient does not owe tax on an exempt supply.
      const r = computeTax({ ...base, treatment: "exempt" });
      expect(r.note).toBe(EXEMPT_NOTE);
    });
  });

  describe("regime: none", () => {
    it("produces no components at all", () => {
      const r = computeTax({ ...base, regime: "none" });
      expect(r.components).toEqual([]);
      expect(r.totalMinor).toBe(1000000);
      expect(r.note).toBeNull();
    });
  });

  describe("regime: single_rate (VAT)", () => {
    it("produces exactly one component", () => {
      const r = computeTax({ ...base, regime: "single_rate", ratePct: 20 });
      expect(r.components).toHaveLength(1);
      expect(r.components[0]).toMatchObject({
        component_code: "VAT",
        component_label: "VAT 20%",
        rate_pct: 20,
        amount_minor: 200000,
      });
      expect(r.totalMinor).toBe(1200000);
    });

    it("ignores the regions entirely", () => {
      const a = computeTax({ ...base, regime: "single_rate", ratePct: 20, placeOfSupplyRegion: "KA" });
      const b = computeTax({ ...base, regime: "single_rate", ratePct: 20, placeOfSupplyRegion: "TN" });
      expect(a.components).toEqual(b.components);
    });
  });

  describe("regime: split_rate (India GST)", () => {
    it("splits into two halves within one region", () => {
      const r = computeTax(base);
      expect(r.components.map((c) => c.component_code)).toEqual(["CGST", "SGST"]);
      expect(r.components.map((c) => c.amount_minor)).toEqual([90000, 90000]);
      expect(r.components[0].component_label).toBe("CGST 9%");
      expect(r.totalMinor).toBe(1180000);
    });

    it("combines into one component across regions", () => {
      const r = computeTax({ ...base, placeOfSupplyRegion: "TN" });
      expect(r.components.map((c) => c.component_code)).toEqual(["IGST"]);
      expect(r.components[0].amount_minor).toBe(180000);
      expect(r.totalMinor).toBe(1180000);
    });

    it("charges the same total either way for an identical sale", () => {
      const intra = computeTax({ ...base, taxableValueMinor: 100123 });
      const inter = computeTax({ ...base, taxableValueMinor: 100123, placeOfSupplyRegion: "TN" });
      expect(intra.totalTaxMinor).toBe(inter.totalTaxMinor);
      expect(intra.totalMinor).toBe(inter.totalMinor);
    });

    it("never loses or invents a unit when the halves are uneven", () => {
      // 18% of 100,123 is 18,022.14 → 18,022, which does not halve evenly.
      const r = computeTax({ ...base, taxableValueMinor: 100123 });
      const sum = r.components.reduce((s, c) => s + c.amount_minor, 0);
      expect(sum).toBe(r.totalTaxMinor);
      expect(r.components.map((c) => c.amount_minor)).toEqual([9011, 9011]);
    });

    it("treats an unknown place of supply as intra-region", () => {
      const r = computeTax({ ...base, placeOfSupplyRegion: null });
      expect(r.components).toHaveLength(2);
    });

    it("is insensitive to region case and whitespace", () => {
      const r = computeTax({ ...base, supplierRegion: " ka ", placeOfSupplyRegion: "KA" });
      expect(r.components).toHaveLength(2);
    });

    it("accepts another jurisdiction's split codes", () => {
      const r = computeTax({
        ...base,
        splitCodes: { first: "SGST", second: "UTGST", combined: "IGST" },
      });
      expect(r.components.map((c) => c.component_code)).toEqual(["SGST", "UTGST"]);
    });

    it("renders a fractional half rate readably", () => {
      const r = computeTax({ ...base, ratePct: 5 });
      expect(r.components[0].component_label).toBe("CGST 2.5%");
    });
  });

  describe("edge cases", () => {
    it("a zero rate produces no components in any regime", () => {
      expect(computeTax({ ...base, ratePct: 0 }).components).toEqual([]);
      expect(computeTax({ ...base, regime: "single_rate", ratePct: 0 }).components).toEqual([]);
    });

    it("a zero taxable value produces zero tax", () => {
      const r = computeTax({ ...base, taxableValueMinor: 0 });
      expect(r.totalTaxMinor).toBe(0);
      expect(r.totalMinor).toBe(0);
    });

    it("one minor unit does not vanish or explode", () => {
      const r = computeTax({ ...base, taxableValueMinor: 1 });
      expect(r.totalTaxMinor).toBe(r.components.reduce((s, c) => s + c.amount_minor, 0));
      expect(r.totalMinor).toBe(1 + r.totalTaxMinor);
    });

    it("rejects a negative taxable value", () => {
      expect(() => computeTax({ ...base, taxableValueMinor: -1 })).toThrow(/negative/);
    });

    it("rejects a non-integer taxable value", () => {
      expect(() => computeTax({ ...base, taxableValueMinor: 10.5 })).toThrow(/integer minor units/);
    });

    it("rejects an out-of-range rate", () => {
      expect(() => computeTax({ ...base, ratePct: -1 })).toThrow(/between 0 and 100/);
      expect(() => computeTax({ ...base, ratePct: 101 })).toThrow(/between 0 and 100/);
    });

    it("does not mutate its input", () => {
      const input = { ...base };
      const copy = JSON.parse(JSON.stringify(input));
      computeTax(input);
      expect(input).toEqual(copy);
    });
  });
});
