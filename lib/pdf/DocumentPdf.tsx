import { resolveInvoiceTemplate } from "@/lib/pdf/templates/registry";
import type { InvoiceTemplateProps } from "@/lib/pdf/templates/types";

/**
 * Dispatches to the organisation's chosen invoice template. The data layer
 * (snapshot, tax breakdown, amount-in-words, money formatting) is identical
 * across every template — see templates/types.ts and templates/classic.tsx
 * for that reasoning. This file's only job is picking which JSX renders it.
 *
 * `templateKey` is read live from `organisations.invoice_template` by the
 * caller, never from the frozen snapshot — like the logo, it's cosmetic, not
 * a fact about the transaction, so switching templates instantly changes how
 * every past document reprints.
 */
export function DocumentPdf({
  snapshot,
  logoDataUri,
  balance,
  invoiceOptions,
  compliance,
  templateKey,
}: InvoiceTemplateProps & { templateKey?: string | null }) {
  // Called as a plain function, not `<Template .../>` — the renderer is
  // picked from a fixed registry, not defined fresh each render, but JSX's
  // capitalized-tag form reads to eslint's react-hooks rule as exactly that.
  const Template = resolveInvoiceTemplate(templateKey);
  return Template({ snapshot, logoDataUri, balance, invoiceOptions, compliance });
}
