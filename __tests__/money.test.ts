import {
  toMinor, fromMinor, assertMinor, addMinor, subtractMinor,
  formatMoney, minorUnitExponent, isSupportedCurrency, splitMinor,
} from "@/lib/money";

describe("money", () => {
  it("exists because floats cannot hold money", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(toMinor(0.1 + 0.2, "INR")).toBe(30);
  });

  describe("minor units are per-currency, not always 2 decimals", () => {
    it.each([
      ["INR", 2], ["GBP", 2], ["USD", 2],
      ["JPY", 0],
      ["KWD", 3], ["BHD", 3],
    ])("%s has exponent %i", (currency, exp) => {
      expect(minorUnitExponent(currency)).toBe(exp);
    });

    it("1000 yen is 1000 minor units, not 100000", () => {
      expect(toMinor(1000, "JPY")).toBe(1000);
    });

    it("1 dinar is 1000 minor units", () => {
      expect(toMinor(1, "KWD")).toBe(1000);
    });

    it("refuses an unknown currency rather than assuming 2", () => {
      expect(() => toMinor(10, "XYZ")).toThrow(/Unknown currency/);
      expect(isSupportedCurrency("XYZ")).toBe(false);
    });

    it("is case-insensitive about the code", () => {
      expect(minorUnitExponent("inr")).toBe(2);
    });
  });

  describe("conversion", () => {
    it("scales then rounds, so 19.99 does not become 1998", () => {
      expect(toMinor(19.99, "INR")).toBe(1999);
    });

    it("round-trips", () => {
      expect(fromMinor(toMinor(1234.56, "GBP"), "GBP")).toBe(1234.56);
    });

    it("rejects non-finite input", () => {
      expect(() => toMinor(NaN, "INR")).toThrow(/finite/);
      expect(() => toMinor(Infinity, "INR")).toThrow(/finite/);
    });

    it("catches major units passed where minor were expected", () => {
      // The bug this guards: someone passes 10.50 instead of 1050.
      expect(() => assertMinor(10.5)).toThrow(/integer minor units/);
    });
  });

  describe("arithmetic", () => {
    it("sums without drift where floats would drift", () => {
      const tenPaise = Array.from({ length: 10 }, () => toMinor(0.1, "INR"));
      expect(addMinor(...tenPaise)).toBe(100);
      expect(fromMinor(addMinor(...tenPaise), "INR")).toBe(1);
    });

    it("subtracts", () => {
      expect(subtractMinor(1180000, 500000)).toBe(680000);
    });

    it("refuses to operate on non-integers", () => {
      expect(() => addMinor(100, 0.5)).toThrow(/integer minor units/);
      expect(() => subtractMinor(0.5, 100)).toThrow(/integer minor units/);
    });
  });

  describe("splitMinor", () => {
    it("splits evenly when it can", () => {
      expect(splitMinor(180000, 2)).toEqual([90000, 90000]);
    });

    it("never loses or invents a unit on an odd amount", () => {
      expect(splitMinor(1801, 2)).toEqual([901, 900]);
      expect(splitMinor(1801, 2).reduce((a, b) => a + b, 0)).toBe(1801);
    });

    it("distributes the remainder across more than two parts", () => {
      const parts = splitMinor(100, 3);
      expect(parts).toEqual([34, 33, 33]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    });

    it("rejects a nonsense part count", () => {
      expect(() => splitMinor(100, 0)).toThrow(/positive integer/);
    });
  });

  describe("formatMoney", () => {
    it("groups Indian digits the Indian way", () => {
      // 12,34,567.89 — not 1,234,567.89
      expect(formatMoney(123456789, "INR", "en-IN")).toContain("12,34,567.89");
    });

    it("groups the same number the British way for GBP", () => {
      expect(formatMoney(123456789, "GBP", "en-GB")).toContain("1,234,567.89");
    });

    it("shows no decimal places for a zero-decimal currency", () => {
      const out = formatMoney(1000, "JPY", "ja-JP");
      expect(out).toContain("1,000");
      expect(out).not.toContain(".00");
    });

    it("shows three for a three-decimal currency", () => {
      expect(formatMoney(1500, "KWD", "en-GB")).toContain("1.500");
    });

    it("can name the currency by code, for PDFs and cross-border documents", () => {
      // The PDF base fonts have no rupee glyph, so an invoice asking for the
      // symbol renders a broken box where the amount should be.
      expect(formatMoney(12345678, "INR", "en-IN", { display: "code" })).toContain("INR");
      expect(formatMoney(12345678, "INR", "en-IN", { display: "code" })).toContain("1,23,456.78");
      expect(formatMoney(12345678, "INR", "en-IN", { display: "code" })).not.toContain("\u20B9");
    });

    it("can omit the currency entirely", () => {
      const out = formatMoney(123456, "INR", "en-IN", { display: "none" });
      expect(out).not.toContain("₹");
      expect(out).toContain("1,234.56");
    });
  });
});
