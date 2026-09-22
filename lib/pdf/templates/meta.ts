/**
 * Template metadata only — no @react-pdf/renderer import here, so this file
 * is safe to pull into a client component (the Settings picker) without
 * dragging the PDF renderer into the browser bundle. registry.ts imports
 * this list too, so the two can never drift.
 */
export const INVOICE_TEMPLATES = [
  {
    key: "classic",
    label: "Classic",
    description: "Dense, fully-bordered grid — the look of a printed GST tax invoice.",
  },
  {
    key: "modern",
    label: "Modern",
    description: "Soft cards, rounded corners, one accent colour, more whitespace.",
  },
] as const;

export type InvoiceTemplateKey = (typeof INVOICE_TEMPLATES)[number]["key"];
