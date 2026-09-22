/**
 * Money. Integer minor units only, always paired with a currency.
 *
 * WHY THIS FILE EXISTS: PostgREST serialises Postgres `numeric` to a JSON
 * number, which JavaScript parses as a float. `0.1 + 0.2 !== 0.3`, so a
 * document total drifts by a unit and an accountant eventually finds it.
 *
 * RULE: no arithmetic on a money value happens outside this file.
 *
 * Unlike LedgerFlow's paise-only version, every function here takes the
 * currency, because "minor unit" is not universally two decimal places —
 * JPY has none and KWD has three. A `toPaise` with a hardcoded 100 is exactly
 * the assumption that makes a codebase single-country.
 */

/** ISO 4217 minor-unit exponents for the currencies we support. */
const MINOR_UNIT_EXPONENT: Readonly<Record<string, number>> = {
  INR: 2,
  GBP: 2,
  USD: 2,
  EUR: 2,
  AUD: 2,
  CAD: 2,
  SGD: 2,
  AED: 2,
  ZAR: 2,
  // Zero-decimal currencies: the minor unit IS the major unit.
  JPY: 0,
  KRW: 0,
  VND: 0,
  // Three-decimal currencies.
  KWD: 3,
  BHD: 3,
  OMR: 3,
  TND: 3,
};

export type CurrencyCode = string;

export function isSupportedCurrency(currency: string): boolean {
  return currency.toUpperCase() in MINOR_UNIT_EXPONENT;
}

/** How many decimal places this currency's minor unit represents. */
export function minorUnitExponent(currency: CurrencyCode): number {
  const exp = MINOR_UNIT_EXPONENT[currency.toUpperCase()];
  if (exp === undefined) {
    throw new Error(
      `Unknown currency "${currency}". Add it to MINOR_UNIT_EXPONENT in lib/money.ts with its ISO 4217 exponent — guessing 2 is how a JPY invoice ends up 100x wrong.`,
    );
  }
  return exp;
}

function factor(currency: CurrencyCode): number {
  return 10 ** minorUnitExponent(currency);
}

/** Major units (possibly a float, e.g. straight from a form) → integer minor units. */
export function toMinor(major: number, currency: CurrencyCode): number {
  if (!Number.isFinite(major)) {
    throw new Error(`toMinor: expected a finite number, got ${major}`);
  }
  // Scale then round: 19.99 * 100 is 1998.9999999999998 in IEEE-754.
  return Math.round(major * factor(currency));
}

/** Integer minor units → major units, as a number safe for display only. */
export function fromMinor(minor: number, currency: CurrencyCode): number {
  assertMinor(minor);
  return minor / factor(currency);
}

export function assertMinor(minor: number): void {
  if (!Number.isInteger(minor)) {
    throw new Error(`Expected integer minor units, got ${minor}. Use toMinor() first.`);
  }
}

export function addMinor(...values: number[]): number {
  let sum = 0;
  for (const v of values) {
    assertMinor(v);
    sum += v;
  }
  return sum;
}

export function subtractMinor(a: number, b: number): number {
  assertMinor(a);
  assertMinor(b);
  return a - b;
}

/**
 * How the currency is named alongside the number.
 *
 *   symbol  ₹1,00,000.00   — the web app, where the font has every glyph
 *   code    INR 1,00,000.00 — PDFs, and anything crossing a border
 *   none    1,00,000.00     — inside an input, or a column already headed INR
 *
 * `code` exists for a concrete reason rather than as a preference: PDFs are
 * typeset in the PDF base fonts, whose standard encoding has no ₹. An Indian
 * invoice asking for the symbol gets a broken glyph where the amount should
 * be — the single most important number on the page. Embedding a font that
 * covers it is the eventual fix; naming the currency is the correct one
 * meanwhile, and on a cross-border document it is arguably better anyway.
 */
export type MoneyDisplay = "symbol" | "code" | "none";

/**
 * Format for display. The locale decides the digit grouping — en-IN groups as
 * 12,34,567 and en-GB as 1,234,567 for the same number — so it is a required
 * argument rather than a default that silently formats an Indian invoice the
 * wrong way.
 */
export function formatMoney(
  minor: number,
  currency: CurrencyCode,
  locale: string,
  opts?: { display?: MoneyDisplay },
): string {
  assertMinor(minor);
  const exp = minorUnitExponent(currency);
  const display = opts?.display ?? "symbol";

  const formatted = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    currencyDisplay: display === "code" ? "code" : "symbol",
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(minor / factor(currency));

  if (display === "none") {
    // Strip the currency symbol and any space that followed it, without
    // assuming which side of the number it sits on.
    return formatted.replace(/[^\d.,\-\s]/g, "").trim();
  }
  return formatted;
}

/**
 * A free-form document line's amount, derived from its rate and quantity
 * rather than trusted as a bare client-supplied figure. Without this, a
 * caller could submit a line whose displayed rate × qty implies one amount
 * but whose amount_minor is something else entirely — and amount_minor is
 * exactly what feeds tax computation.
 */
export function lineAmountMinor(rateMinor: number, quantity: number, discountMinor = 0): number {
  assertMinor(rateMinor);
  assertMinor(discountMinor);
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error(`lineAmountMinor: expected a non-negative finite quantity, got ${quantity}`);
  }
  return Math.round(rateMinor * quantity) - discountMinor;
}

/**
 * Split an amount into `parts` pieces that sum back to exactly the original.
 * Used by the split_rate tax regime: half of 1,801 minor units is not a whole
 * number, and rounding each half independently would lose or gain a unit.
 */
export function splitMinor(minor: number, parts: number): number[] {
  assertMinor(minor);
  if (!Number.isInteger(parts) || parts < 1) {
    throw new Error(`splitMinor: parts must be a positive integer, got ${parts}`);
  }
  const base = Math.floor(minor / parts);
  const remainder = minor - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}
