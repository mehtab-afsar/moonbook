import { assertMinor, splitMinor } from "@/lib/money";

/**
 * Tax. One entry point, a closed set of three regimes, and no formula
 * language — see CONVENTIONS.md section 10.
 *
 * This is the ONLY place tax is computed. The SQL layer accepts the breakdown
 * as a parameter and stores it; it never recomputes, so the two can never
 * drift. The result is a list of components rather than fixed cgst/sgst/igst
 * fields, which is what lets India (two components, or one) and the UK (one)
 * share a schema and a renderer.
 */

export type TaxRegime = "none" | "single_rate" | "split_rate";
export type TaxTreatment = "forward" | "reverse_charge" | "exempt";

/**
 * Deliberately a `type` and not an `interface`: only a type alias gets TS's
 * implicit index signature, and without it this cannot be passed as a jsonb
 * RPC argument without a cast. A cast here would be a cast on the one value
 * the tax engine exists to produce.
 */
export type TaxComponent = {
  /** Machine code stored on the document: 'CGST', 'SGST', 'IGST', 'VAT'. */
  component_code: string;
  /** What prints on the document: "CGST 9%". */
  component_label: string;
  rate_pct: number;
  amount_minor: number;
  sort_order: number;
};

export interface TaxInput {
  regime: TaxRegime;
  treatment: TaxTreatment;
  taxableValueMinor: number;
  ratePct: number;
  /** Where the seller is registered. Only split_rate reads these. */
  supplierRegion?: string | null;
  /** Where the supply is made to. */
  placeOfSupplyRegion?: string | null;
  /**
   * Codes for the two halves of a split, and for the combined component.
   * Defaults are India's GST because that is the first split_rate market;
   * another split-rate jurisdiction passes its own.
   */
  splitCodes?: { first: string; second: string; combined: string };
}

export interface TaxResult {
  components: TaxComponent[];
  totalTaxMinor: number;
  totalMinor: number;
  /** Why the tax is what it is — rendered on the document when there is none. */
  note: string | null;
}

export const REVERSE_CHARGE_NOTE =
  "Tax payable by the recipient under reverse charge.";
export const EXEMPT_NOTE = "Exempt / nil-rated — no tax charged.";

const DEFAULT_SPLIT_CODES = { first: "CGST", second: "SGST", combined: "IGST" };

/**
 * Exemption is checked before treatment, and treatment before the regime.
 * That ordering matters: an exempt supply under reverse charge carries no tax
 * and should say it is exempt, not that the recipient owes the tax.
 */
export function computeTax(input: TaxInput): TaxResult {
  const { taxableValueMinor, treatment, regime } = input;
  assertMinor(taxableValueMinor);
  if (taxableValueMinor < 0) {
    throw new Error(`computeTax: taxable value cannot be negative, got ${taxableValueMinor}`);
  }
  if (input.ratePct < 0 || input.ratePct > 100) {
    throw new Error(`computeTax: rate must be between 0 and 100, got ${input.ratePct}`);
  }

  if (treatment === "exempt") {
    return { components: [], totalTaxMinor: 0, totalMinor: taxableValueMinor, note: EXEMPT_NOTE };
  }
  if (treatment === "reverse_charge") {
    return {
      components: [],
      totalTaxMinor: 0,
      totalMinor: taxableValueMinor,
      note: REVERSE_CHARGE_NOTE,
    };
  }
  if (regime === "none" || input.ratePct === 0) {
    return { components: [], totalTaxMinor: 0, totalMinor: taxableValueMinor, note: null };
  }

  const components =
    regime === "split_rate" ? splitRate(input) : singleRate(input);
  const totalTaxMinor = components.reduce((sum, c) => sum + c.amount_minor, 0);

  return {
    components,
    totalTaxMinor,
    totalMinor: taxableValueMinor + totalTaxMinor,
    note: null,
  };
}

/** One component at one rate — VAT, GCC VAT, simple sales tax. */
function singleRate(input: TaxInput): TaxComponent[] {
  const amount = roundHalfUp((input.taxableValueMinor * input.ratePct) / 100);
  return [
    {
      component_code: "VAT",
      component_label: `VAT ${formatRate(input.ratePct)}%`,
      rate_pct: input.ratePct,
      amount_minor: amount,
      sort_order: 0,
    },
  ];
}

/**
 * India's GST shape: within one region the rate splits into two equal halves
 * (CGST + SGST); across regions it is one combined component (IGST).
 *
 * The total is computed ONCE and then split, rather than computing each half
 * from the rate independently. Halving 18% of 1,001 minor units two ways and
 * rounding each gives 90 + 90 = 180, while the true 18% is 180.18 → 180 — the
 * same here, but at other values the two methods differ by a unit, and the
 * intra-state and inter-state totals for an identical sale must match.
 */
function splitRate(input: TaxInput): TaxComponent[] {
  const codes = input.splitCodes ?? DEFAULT_SPLIT_CODES;
  const total = roundHalfUp((input.taxableValueMinor * input.ratePct) / 100);

  const supplier = normaliseRegion(input.supplierRegion);
  const placeOfSupply = normaliseRegion(input.placeOfSupplyRegion);
  // Unknown place of supply is treated as intra-region: the conservative
  // assumption, since it is the more common case and is visibly wrong on the
  // document if it is not, rather than silently under-collecting.
  const intraRegion = placeOfSupply === null || supplier === placeOfSupply;

  if (!intraRegion) {
    return [
      {
        component_code: codes.combined,
        component_label: `${codes.combined} ${formatRate(input.ratePct)}%`,
        rate_pct: input.ratePct,
        amount_minor: total,
        sort_order: 0,
      },
    ];
  }

  const [first, second] = splitMinor(total, 2);
  const half = input.ratePct / 2;
  return [
    {
      component_code: codes.first,
      component_label: `${codes.first} ${formatRate(half)}%`,
      rate_pct: half,
      amount_minor: first,
      sort_order: 0,
    },
    {
      component_code: codes.second,
      component_label: `${codes.second} ${formatRate(half)}%`,
      rate_pct: half,
      amount_minor: second,
      sort_order: 1,
    },
  ];
}

function normaliseRegion(region: string | null | undefined): string | null {
  const trimmed = region?.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

/**
 * Round half away from zero. `Math.round` rounds half UP, which for negatives
 * rounds -0.5 to -0 rather than -1 — tax amounts are never negative here, but
 * relying on that is how a sign bug survives a refactor.
 */
function roundHalfUp(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** "18" not "18.00"; "2.5" kept. */
function formatRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : String(Number(rate.toFixed(2)));
}
