import { assertMinor } from "@/lib/money";

/**
 * Pricing: how an activity's amount is derived from what was recorded.
 *
 * A CLOSED SET OF THREE, and no formula language. The temptation with
 * configurable billing is to ship an expression evaluator so a customer can
 * write `weight * rate * 1.05`. That is a programming language with a
 * debugger, a security boundary and a support burden attached, and it is how
 * this kind of product stops being a billing tool.
 *
 * When a customer needs something outside these, they use `manual` and type
 * the figure. When THREE separate customers need the same missing strategy, a
 * fourth gets built here as real, tested code.
 *
 * Computed in TypeScript and passed to record_activity(), never recomputed in
 * SQL — the same rule tax follows, for the same reason.
 */

export type PricingStrategy = "manual" | "flat" | "quantity_rate";

export interface PricingConfig {
  /** flat: the fixed amount, in minor units. */
  amount_minor?: number;
  /** quantity_rate: which detail field holds the quantity. */
  quantity_field?: string;
  /** quantity_rate: which detail field holds the rate, in minor units. */
  rate_field?: string;
  /** quantity_rate: a fixed rate in minor units, when it is not per-record. */
  rate_minor?: number;
}

export interface PricingInput {
  strategy: PricingStrategy;
  config: PricingConfig;
  details: Record<string, unknown>;
  /** Required by the `manual` strategy, ignored by the others. */
  manualAmountMinor?: number;
}

export interface PricingResult {
  amountMinor: number;
  /** Shown under the amount so the number is never unexplained. */
  explanation: string;
}

export class PricingError extends Error {}

export function computeAmount(input: PricingInput): PricingResult {
  switch (input.strategy) {
    case "manual":
      return manual(input);
    case "flat":
      return flat(input);
    case "quantity_rate":
      return quantityRate(input);
    default: {
      // Exhaustiveness: adding a strategy to the type without handling it here
      // is a compile error rather than a silent zero.
      const unreachable: never = input.strategy;
      throw new PricingError(`Unknown pricing strategy: ${String(unreachable)}`);
    }
  }
}

function manual(input: PricingInput): PricingResult {
  if (input.manualAmountMinor === undefined || input.manualAmountMinor === null) {
    throw new PricingError("Enter an amount.");
  }
  assertMinor(input.manualAmountMinor);
  if (input.manualAmountMinor < 0) throw new PricingError("Amount cannot be negative.");
  return { amountMinor: input.manualAmountMinor, explanation: "Entered directly" };
}

function flat(input: PricingInput): PricingResult {
  const amount = input.config.amount_minor;
  if (amount === undefined || amount === null) {
    throw new PricingError("This activity type has no fixed amount configured.");
  }
  assertMinor(amount);
  if (amount < 0) throw new PricingError("Configured amount cannot be negative.");
  return { amountMinor: amount, explanation: "Fixed price" };
}

function quantityRate(input: PricingInput): PricingResult {
  const { quantity_field, rate_field, rate_minor } = input.config;

  if (!quantity_field) {
    throw new PricingError("This activity type has no quantity field configured.");
  }
  const quantity = numberFrom(input.details[quantity_field], quantity_field);
  if (quantity < 0) throw new PricingError(`${quantity_field} cannot be negative.`);

  let rate: number;
  if (rate_field) {
    rate = numberFrom(input.details[rate_field], rate_field);
  } else if (rate_minor !== undefined && rate_minor !== null) {
    rate = rate_minor;
  } else {
    throw new PricingError("This activity type has neither a rate field nor a fixed rate configured.");
  }
  assertMinor(rate);
  if (rate < 0) throw new PricingError("Rate cannot be negative.");

  // Quantity may legitimately be fractional (2.5 tonnes, 1.5 hours); the rate
  // and the result are always whole minor units.
  const amountMinor = Math.round(quantity * rate);
  return {
    amountMinor,
    explanation: `${trimNumber(quantity)} × ${rate} minor units`,
  };
}

function numberFrom(value: unknown, fieldKey: string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PricingError(`${fieldKey} must be a finite number.`);
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new PricingError(`${fieldKey} is needed to work out the amount.`);
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}
