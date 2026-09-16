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
    /**
     * The rate now lives in a `money` field and is typed in MAJOR units, so
     * every case here carries the field definitions and a currency. That is
     * the contract, not ceremony: read from a plain `number` the same 42 could
     * mean 42 rupees or 42 paise, and this engine used to assume paise — which
     * billed a scrap yard a hundredfold short. See migration 0019.
     */
    const config = { quantity_field: "weight_kg", rate_field: "rate_per_kg" };
    const fields = [
      { key: "weight_kg", field_type: "number" },
      { key: "rate_per_kg", field_type: "money" },
    ];
    const ctx = { fields, currency: "INR" };

    it("multiplies a field by a field", () => {
      // 500 kg at ₹42.00 is ₹21,000.00.
      const r = computeAmount({
        strategy: "quantity_rate",
        config,
        details: { weight_kg: 500, rate_per_kg: 42 },
        ...ctx,
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
      // 2.5 kg at ₹3.33 is ₹8.325, which is not a payable amount.
      const r = computeAmount({
        strategy: "quantity_rate",
        config,
        details: { weight_kg: 2.5, rate_per_kg: 3.33 },
        ...ctx,
      });
      expect(r.amountMinor).toBe(833); // 832.5 → 833
      expect(Number.isInteger(r.amountMinor)).toBe(true);
    });

    it("accepts a numeric string, because form inputs produce strings", () => {
      const r = computeAmount({
        strategy: "quantity_rate",
        config,
        details: { weight_kg: "500", rate_per_kg: "42" },
        ...ctx,
      });
      expect(r.amountMinor).toBe(2100000);
    });

    it("says which field is missing rather than returning zero", () => {
      expect(() =>
        computeAmount({ strategy: "quantity_rate", config, details: { weight_kg: 500 }, ...ctx }),
      ).toThrow(/rate_per_kg is needed/);
    });

    it("rejects a non-numeric value", () => {
      expect(() =>
        computeAmount({ strategy: "quantity_rate", config, details: { weight_kg: "heavy", rate_per_kg: 10 }, ...ctx }),
      ).toThrow(/weight_kg is needed/);
    });

    it("rejects negatives on either side", () => {
      expect(() =>
        computeAmount({ strategy: "quantity_rate", config, details: { weight_kg: -1, rate_per_kg: 10 }, ...ctx }),
      ).toThrow(/cannot be negative/);
      expect(() =>
        computeAmount({ strategy: "quantity_rate", config, details: { weight_kg: 1, rate_per_kg: -10 }, ...ctx }),
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

    it("refuses a rate field that is not an amount, rather than guessing its unit", () => {
      // The whole point. A `number` rate of 42 could be 42 or 0.42, and this
      // engine used to silently choose 0.42.
      expect(() =>
        computeAmount({
          strategy: "quantity_rate",
          config,
          details: { weight_kg: 500, rate_per_kg: 42 },
          currency: "INR",
          fields: [
            { key: "weight_kg", field_type: "number" },
            { key: "rate_per_kg", field_type: "number" },
          ],
        }),
      ).toThrow(/must be an amount field, not a number/);
    });

    it("prices a scrap yard's load the way the scrap yard would", () => {
      // The case that found the bug: 1,840 kg at 22 a kilo. Read as minor
      // units that came to 40,480 minor — 404.80 — instead of 40,480.
      const r = computeAmount({
        strategy: "quantity_rate",
        config,
        details: { weight_kg: 1840, rate_per_kg: 22 },
        ...ctx,
      });
      expect(r.amountMinor).toBe(4048000);
    });

    it("a zero quantity is a legitimate zero, not an error", () => {
      const r = computeAmount({
        strategy: "quantity_rate",
        config,
        details: { weight_kg: 0, rate_per_kg: 42 },
        ...ctx,
      });
      expect(r.amountMinor).toBe(0);
    });
  });
});
