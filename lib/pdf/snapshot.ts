import { z } from "zod";

/**
 * The shape of `documents.issued_snapshot`, parsed rather than trusted.
 *
 * It is written by issue_document() as `to_jsonb(...)` of real rows, so it is
 * structurally reliable — but it is also the ONE piece of data in the system
 * that outlives every schema it came from. A snapshot written today will be
 * re-rendered in five years against whatever this code has become, and the
 * failure mode of a silently-missing key is a PDF with a blank total, which
 * looks like a document rather than like an error.
 *
 * So it is parsed. A snapshot that no longer fits fails loudly at render time
 * with a message naming the field, and the document is never served wrong.
 *
 * Everything added after the first release is `.optional()` with a default:
 * old snapshots are immutable by design and will never gain the new keys.
 */

const moneySchema = z.number().int();

const partySchema = z
  .object({
    name: z.string(),
    tax_id: z.string().nullish(),
    tax_id_kind: z.string().nullish(),
    address: z.string().nullish(),
    region_code: z.string().nullish(),
    country_code: z.string().nullish(),
  })
  .loose();

export const snapshotSchema = z.object({
  document: z
    .object({
      id: z.string(),
      direction: z.string(),
      doc_kind: z.string(),
      doc_no: z.string().nullish(),
      party_doc_no: z.string().nullish(),
      doc_date: z.string(),
      due_date: z.string().nullish(),
      currency: z.string(),
      taxable_value_minor: moneySchema,
      round_off_minor: moneySchema.default(0),
      total_minor: moneySchema,
      tax_treatment: z.string(),
      notes: z.string().nullish(),
    })
    .loose(),

  lines: z.array(
    z
      .object({
        description: z.string(),
        hsn_sac: z.string().nullish(),
        quantity: z.coerce.number().nullish(),
        unit: z.string().nullish(),
        rate_minor: moneySchema.nullish(),
        discount_minor: moneySchema.default(0),
        amount_minor: moneySchema,
        // Added in migration 0013; absent on anything issued before it.
        printable_details: z
          .array(z.object({ label: z.string(), value: z.string() }))
          .default([]),
      })
      .loose(),
  ),

  /**
   * Zero rows for a tax-free org, one for VAT or IGST, two for CGST+SGST.
   * The renderer iterates; it never asks which country this is.
   */
  taxes: z.array(
    z
      .object({
        component_code: z.string(),
        component_label: z.string(),
        rate_pct: z.coerce.number(),
        amount_minor: moneySchema,
        sort_order: z.number().int().default(0),
      })
      .loose(),
  ),

  counterparty: partySchema,
  ship_to: partySchema.nullish(),

  organisation: z
    .object({
      legal_name: z.string(),
      tax_id: z.string().nullish(),
      tax_id_kind: z.string().nullish(),
      region_code: z.string().nullish(),
      address: z.string().nullish(),
      locale: z.string().default("en"),
      base_currency: z.string(),
    })
    .loose(),
});

export type DocumentSnapshot = z.infer<typeof snapshotSchema>;

export function parseSnapshot(raw: unknown): DocumentSnapshot {
  const result = snapshotSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new Error(
      `issued_snapshot is not renderable: ${first.path.join(".") || "(root)"} — ${first.message}`,
    );
  }
  return result.data;
}
