import { ClassicTemplate } from "@/lib/pdf/templates/classic";
import { ModernTemplate } from "@/lib/pdf/templates/modern";
import { INVOICE_TEMPLATES, type InvoiceTemplateKey } from "@/lib/pdf/templates/meta";
import type { InvoiceTemplateComponent } from "@/lib/pdf/templates/types";

export { INVOICE_TEMPLATES, type InvoiceTemplateKey };

const RENDERERS: Record<InvoiceTemplateKey, InvoiceTemplateComponent> = {
  classic: ClassicTemplate,
  modern: ModernTemplate,
};

const DEFAULT_TEMPLATE: InvoiceTemplateKey = "classic";

/** A stored key can be anything (an old value, a typo, null from a snapshot
 *  written before this existed) — this always returns a real renderer. */
export function resolveInvoiceTemplate(key: string | null | undefined): InvoiceTemplateComponent {
  if (key && key in RENDERERS) return RENDERERS[key as InvoiceTemplateKey];
  return RENDERERS[DEFAULT_TEMPLATE];
}
