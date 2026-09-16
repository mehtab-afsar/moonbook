import type { NextRequest } from "next/server";
import type { z } from "zod";

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Parse and validate a JSON request body. Returns a discriminated union rather
 * than throwing, so every route handler reads the same way:
 *
 *   const parsed = await parseBody(req, schema)
 *   if (!parsed.ok) return apiErr(parsed.error, 422)
 *
 * The error names the offending field, because "Invalid input" is useless to
 * someone trying to fix an invoice.
 */
export async function parseBody<T extends z.ZodTypeAny>(
  req: NextRequest,
  schema: T,
): Promise<ParseResult<z.infer<T>>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, error: "Invalid or missing JSON body" };
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return { ok: false, error: `${path}${issue.message}` };
  }

  return { ok: true, data: result.data };
}

/** Same, for query strings and multipart forms. */
export function parseParams<T extends z.ZodTypeAny>(
  input: unknown,
  schema: T,
): ParseResult<z.infer<T>> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return { ok: false, error: `${path}${issue.message}` };
  }
  return { ok: true, data: result.data };
}
