/**
 * The closed sets, in one place.
 *
 * CONVENTIONS.md §0 says the architecture rests on closed sets rather than
 * languages: field types, pricing strategies, tax regimes and document states
 * are small, fixed, tested lists, because a formula parser is an unbounded bug
 * surface. A closed set is only closed if everyone agrees where it ends — and
 * until now each list was restated independently in three places: the SQL
 * check constraint, a zod enum in a route, and a style map in a component.
 *
 * Three copies of a list is three chances to add a value to two of them. The
 * failure is quiet: the database accepts a row the UI cannot label, or the API
 * rejects a value the schema allows, and neither says why.
 *
 * These are the TypeScript half. `__tests__/state-machine-parity.test.ts`
 * diffs every one of them against the `check (… in (…))` constraint it mirrors,
 * in BOTH directions, so adding a value to one side without the other fails
 * the build rather than a customer's afternoon.
 *
 * The constraint name is recorded next to each list so the guard can pair them
 * without guessing, and so a reader can find the other half.
 */

/** Which ledger a thing belongs to — money coming in, or money going out. */
export const DIRECTIONS = ["receivable", "payable"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/**
 * What a document IS, which decides the sign. Deliberately separate from
 * `direction`, which decides whose ledger it sits in: conflating them gives
 * you a credit note polluting payables with money you do not owe.
 */
export const DOC_KINDS = ["invoice", "bill", "credit_note", "debit_note"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/**
 * The kinds that BILL something, as opposed to offsetting something already
 * billed. Only these two can be raised from activities; a note is raised
 * against an existing document by issue_credit_note, which is why the two
 * paths are separate and this subset exists.
 */
export const BILLABLE_DOC_KINDS = ["invoice", "bill"] as const;
export type BillableDocKind = (typeof BILLABLE_DOC_KINDS)[number];

export const DOCUMENT_STATUSES = ["draft", "issued", "cancelled"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** `invoiced` is set by issue_document alone — never asserted by a caller. */
export const ACTIVITY_STATUSES = ["pending", "completed", "invoiced", "cancelled"] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

/** The subset a person may set directly. See update_activity. */
export const EDITABLE_ACTIVITY_STATUSES = ["pending", "completed", "cancelled"] as const;
export type EditableActivityStatus = (typeof EDITABLE_ACTIVITY_STATUSES)[number];

export const TAX_REGIMES = ["none", "single_rate", "split_rate"] as const;
export type TaxRegimeName = (typeof TAX_REGIMES)[number];

/** Orthogonal to the regime: both GST and EU VAT have all three. */
export const TAX_TREATMENTS = ["forward", "reverse_charge", "exempt"] as const;
export type TaxTreatmentName = (typeof TAX_TREATMENTS)[number];

export const PAYMENT_DIRECTIONS = ["in", "out"] as const;
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];

export const PAYMENT_METHODS = ["cash", "bank", "card", "online", "cheque"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Six field types, not eleven. Each one costs five surfaces: a form widget, a
 * zod branch, a PDF renderer, a filter control and a trigger branch.
 */
export const FIELD_TYPES = ["text", "long_text", "number", "date", "select", "boolean"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const PRICING_STRATEGIES = ["manual", "flat", "quantity_rate"] as const;
export type PricingStrategyName = (typeof PRICING_STRATEGIES)[number];

export const RESET_CADENCES = ["never", "fiscal_year", "calendar_year", "monthly"] as const;
export type ResetCadence = (typeof RESET_CADENCES)[number];

export const ROLES = ["owner", "staff"] as const;
export type RoleName = (typeof ROLES)[number];

/**
 * Each list paired with the SQL constraint it must equal.
 *
 * EDITABLE_ACTIVITY_STATUSES is deliberately absent: it is a strict subset of
 * activities_status_chk rather than a mirror of it, and the guard asserts that
 * relationship separately.
 */
export const SQL_PARITY: Readonly<Record<string, readonly string[]>> = {
  activities_status_chk: ACTIVITY_STATUSES,
  activities_direction_chk: DIRECTIONS,
  activity_fields_type_chk: FIELD_TYPES,
  activity_types_direction_chk: DIRECTIONS,
  activity_types_pricing_chk: PRICING_STRATEGIES,
  document_series_kind_chk: DOC_KINDS,
  document_series_reset_chk: RESET_CADENCES,
  document_sequences_kind_chk: DOC_KINDS,
  documents_direction_chk: DIRECTIONS,
  documents_kind_chk: DOC_KINDS,
  documents_status_chk: DOCUMENT_STATUSES,
  documents_tax_treatment_chk: TAX_TREATMENTS,
  organisations_tax_regime_chk: TAX_REGIMES,
  payments_direction_chk: PAYMENT_DIRECTIONS,
  payments_method_chk: PAYMENT_METHODS,
  profiles_role_chk: ROLES,
};
