/**
 * The counterparty a document was billed to or from — its own card above
 * the line items, not a name folded into the header subtitle. LedgerFlow's
 * invoice detail page does this (a "Bill to" card with name, tax id, region)
 * and it reads as a real business record, not a bare label.
 *
 * Tax ID and region are short, mono, code-like values, so they share one
 * row. Email and phone are longer free text — each gets its own line rather
 * than wrapping into that row, which read as a cramped, uneven list.
 */
export function PartyCard({
  label,
  name,
  taxId,
  taxIdKind,
  regionCode,
  email,
  phone,
}: {
  label: string;
  name: string;
  taxId?: string | null;
  taxIdKind?: string | null;
  regionCode?: string | null;
  email?: string | null;
  phone?: string | null;
}) {
  return (
    <section className="rounded-[10px] border border-line bg-white p-5">
      <h2 className="text-[13px] font-medium text-ink-2">{label}</h2>
      <p className="mt-1.5 text-[14.5px] font-medium text-ink">{name}</p>
      <div className="mt-1.5 space-y-0.5">
        {(taxId || regionCode) && (
          <p className="flex flex-wrap gap-x-4 font-mono text-[12.5px] text-ink-3">
            {taxId && <span>{taxIdKind ?? "Tax ID"} {taxId}</span>}
            {regionCode && <span>Region {regionCode}</span>}
          </p>
        )}
        {email && <p className="text-[12.5px] text-ink-3">{email}</p>}
        {phone && <p className="font-mono text-[12.5px] text-ink-3">{phone}</p>}
      </div>
    </section>
  );
}
