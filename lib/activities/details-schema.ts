import { z } from "zod";

/**
 * Builds a zod schema for one activity type's `details` from its field
 * definitions, at request time.
 *
 * This is the half of validation that talks to a PERSON. The database trigger
 * (migration 10) makes corruption impossible; this makes the error legible —
 * "Weight must be a number" rather than SQLSTATE 22023. Both run, and neither
 * is redundant: the trigger also covers the write paths that never touch this
 * code, and this covers rules the trigger deliberately doesn't carry.
 *
 * Because `field_type` is a CLOSED SET of six, this is a small mapping rather
 * than an open-ended problem — which is exactly why the set is closed. A new
 * industry adds rows to activity_fields and zero lines here.
 */

export type FieldType = "text" | "long_text" | "number" | "date" | "select" | "boolean";

export interface ActivityField {
  key: string;
  label: string;
  field_type: FieldType;
  options: string[];
  is_required: boolean;
  archived_at?: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function baseFor(field: ActivityField): z.ZodTypeAny {
  switch (field.field_type) {
    case "text":
      return z.string().trim().max(200, `${field.label} is too long`);
    case "long_text":
      return z.string().trim().max(2000, `${field.label} is too long`);
    case "number":
      return z.number({ message: `${field.label} must be a number` }).finite();
    case "date":
      return z.string().regex(ISO_DATE, `${field.label} must be a date`);
    case "boolean":
      return z.boolean({ message: `${field.label} must be true or false` });
    case "select":
      return field.options.length > 0
        ? z.enum(field.options as [string, ...string[]], {
            message: `${field.label} must be one of: ${field.options.join(", ")}`,
          })
        : z.string();
  }
}

/**
 * Archived fields are accepted but never required, so a record captured before
 * a field was retired can still be edited without being rejected for carrying
 * its own history.
 */
export function buildDetailsSchema(fields: ActivityField[]): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    const archived = Boolean(field.archived_at);
    const base = baseFor(field);

    if (field.is_required && !archived) {
      shape[field.key] =
        field.field_type === "text" || field.field_type === "long_text"
          ? (base as z.ZodString).min(1, `${field.label} is required`)
          : base;
    } else {
      shape[field.key] = base.optional().nullable();
    }
  }

  // strict(): an unknown key is an error, not silently dropped. A typo'd key
  // that vanishes is worse than one that complains — the data looks saved.
  return z.object(shape).strict() as unknown as z.ZodType<Record<string, unknown>>;
}

/** Drops empty strings and nulls so they never reach the database as noise. */
export function pruneEmpty(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}
