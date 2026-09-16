import { computeAmount, PricingError, type PricingInput } from "@/lib/pricing";

const base: PricingInput = { strategy: "manual", config: {}, details: {} };

describe("pricing", () => {
  describe("manual", () => {
    it("uses the amount it was given", () => {
      expect(computeAmount({ ...base, manualAmountMinor: 118000 })).toMatchObject({
        amountMinor: 118000,
      });
    });

    it("asks for an amount rather than assuming zero", () => {
      expect(() => computeAmount(base)).toThrow(PricingError);
      expect(() => computeAmount(base)).toThrow(/Enter an amount/);
    });

    it("rejects a negative amount", () => {
      expect(() => computeAmount({ ...base, manualAmountMinor: -1 })).toThrow(/negative/);
    });

    it("rejects major units passed where minor were expected", () => {
      expect(() => computeAmount({ ...base, manualAmountMinor: 1180.5 })).toThrow(/integer minor units/);
    });
  });

  describe("flat", () => {
    it("returns the configured amount and ignores the details", () => {
      const r = computeAmount({
        strategy: "flat",
        config: { amount_minor: 250000 },
        details: { anything: "ignored" },
      });
      expect(r.amountMinor).toBe(250000);
      expect(r.explanation).toBe("Fixed price");
    });

    it("complains when the type has no amount configured", () => {
      expect(() => computeAmount({ strategy: "flat", config: {}, details: {} })).toThrow(
        /no fixed amount configured/,
      );
    });
  });

  describe("quantity_rate", () => {
    const config = { quantity_field: "weight_kg", rate_field: "rate_per_kg_minor" };

    it("multiplies a field by a field", () => {
      const r = computeAmount({
        strategy: "quantity_rate",
        config,
        details: { weight_kg: 500, rate_per_kg_minor: 4200 },
      });
      expect(r.amountMinor).toBe(2100000);
      expect(r.explanation).toBe("500 × 4200 minor units");
    });

    it("multiplies a field by a configured fixed rate", () => {
      const r = computeAmount({
        strategy: "quantity_rate",
        config: { quantity_field: "trips", rate_minor: 1180000 },
        details: { trips: 3 },
      });
      expect(r.amountMinor).toBe(3540000);
    });

    it("handles a fractional quantity and still returns whole minor units", () => {
      const r = computeAmount({
        strategy: "quantity_rate",
        config,
        details: { weight_kg: 2.5, rate_per_kg_minor: 333 },
      });
      expect(r.amountMinor).toBe(833); // 832.5 → 833
      expect(Number.isInteger(r.amountMinor)).toBe(true);
    });

    it("accepts a numeric string, because form inputs produce strings", () => {
      const r = computeAmount({
        strategy: "quantity_rate",
        config,
        details: { weight_kg: "500", rate_per_kg_minor: "4200" },
      });
      expect(r.amountMinor).toBe(2100000);
    });

    it("says which field is missing rather than returning zero", () => {
      expect(() =>
        computeAmount({ strategy: "quantity_rate", config, details: { weight_kg: 500 } }),
      ).toThrow(/rate_per_kg_minor is needed/);
    });

    it("rejects a non-numeric value", () => {
      expect(() =>
        computeAmount({ strategy: "quantity_rate", config, details: { weight_kg: "heavy", rate_per_kg_minor: 10 } }),
      ).toThrow(/weight_kg is needed/);
    });

    it("rejects negatives on either side", () => {
      expect(() =>
        computeAmount({ strategy: "quantity_rate", config, details: { weight_kg: -1, rate_per_kg_minor: 10 } }),
      ).toThrow(/cannot be negative/);
      expect(() =>
        computeAmount({ strategy: "quantity_rate", config, details: { weight_kg: 1, rate_per_kg_minor: -10 } }),
      ).toThrow(/cannot be negative/);
    });

    it("complains when the type is misconfigured rather than guessing", () => {
      expect(() =>
        computeAmount({ strategy: "quantity_rate", config: {}, details: {} }),
      ).toThrow(/no quantity field configured/);
      expect(() =>
        computeAmount({ strategy: "quantity_rate", config: { quantity_field: "q" }, details: { q: 1 } }),
      ).toThrow(/neither a rate field nor a fixed rate/);
    });

    it("a zero quantity is a legitimate zero, not an error", () => {
      const r = computeAmount({
        strategy: "quantity_rate",
        config,
        details: { weight_kg: 0, rate_per_kg_minor: 4200 },
      });
      expect(r.amountMinor).toBe(0);
    });
  });
});
