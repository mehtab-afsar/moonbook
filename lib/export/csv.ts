import "server-only";

/**
 * RFC 4180 field escaping — quote whenever a field contains the delimiter,
 * a quote, or a newline, doubling any quote inside. Anything less and a
 * party name with a comma in it silently shifts every column after it.
 */
function escapeCsvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Builds a CSV string from a header row and an array of row objects. */
export function toCsv<T extends Record<string, string | number | null | undefined>>(
  columns: readonly { key: keyof T; label: string }[],
  rows: T[],
): string {
  const header = columns.map((c) => escapeCsvField(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => escapeCsvField(row[c.key])).join(","));
  // \r\n per RFC 4180 — Excel on Windows reads a bare \n file fine too, but
  // this is the one that never surprises anyone.
  return [header, ...body].join("\r\n") + "\r\n";
}

export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
