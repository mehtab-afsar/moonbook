"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { INVOICE_TEMPLATES, type InvoiceTemplateKey } from "@/lib/pdf/templates/meta";

/**
 * A swatch per template rather than a rendered PDF thumbnail — cheap, and
 * distinctive enough to tell Classic's ruled grid from Modern's soft cards
 * at a glance without round-tripping to the server for a preview image.
 */
function Swatch({ template }: { template: InvoiceTemplateKey }) {
  if (template === "modern") {
    return (
      <div className="flex h-20 w-full flex-col gap-1.5 rounded-lg bg-paper p-2.5">
        <div className="h-2 w-2/5 rounded-full bg-brand/70" />
        <div className="mt-1 flex-1 rounded-md border border-line bg-white" />
        <div className="h-2 w-1/3 self-end rounded-full bg-brand/40" />
      </div>
    );
  }
  return (
    <div className="flex h-20 w-full flex-col border border-ink bg-white p-1.5">
      <div className="border-b border-ink pb-1">
        <div className="mx-auto h-1.5 w-1/3 bg-ink" />
      </div>
      <div className="mt-1.5 flex-1 border border-ink-3" />
      <div className="mt-1 h-1.5 w-full bg-line" />
    </div>
  );
}

export function TemplatePicker({
  current,
  isOwner,
}: {
  current: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(current);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function choose(key: InvoiceTemplateKey) {
    if (key === selected || busy) return;
    setBusy(key);
    setError("");
    const res = await fetch("/api/settings/invoice-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: key }),
    });
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not save that template.");
      return;
    }
    setSelected(key);
    router.refresh();
  }

  return (
    <div>
      <p className="mb-3 text-[13px] font-medium text-ink">Invoice template</p>
      <p className="mb-3 text-[12.5px] text-ink-3">
        How every invoice, bill and credit note prints. Changing this changes how documents you&apos;ve
        already issued reprint too — the numbers never change, only the layout.
      </p>
      {!isOwner ? (
        <p className="text-[13px] text-ink-3">
          Currently {INVOICE_TEMPLATES.find((t) => t.key === current)?.label ?? current}. Only an owner
          can change it.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {INVOICE_TEMPLATES.map((t) => {
            const isSelected = selected === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => choose(t.key)}
                disabled={busy !== null}
                className={`rounded-[10px] border p-2.5 text-left transition ${
                  isSelected ? "border-brand ring-1 ring-brand" : "border-line hover:border-ink-3"
                }`}
              >
                <Swatch template={t.key} />
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="text-[13px] font-medium text-ink">{t.label}</span>
                  {busy === t.key ? (
                    <Loader2 className="size-3.5 animate-spin text-ink-3" />
                  ) : isSelected ? (
                    <Check className="size-3.5 text-brand" strokeWidth={2.5} />
                  ) : null}
                </div>
                <p className="mt-0.5 text-[11.5px] leading-snug text-ink-3">{t.description}</p>
              </button>
            );
          })}
        </div>
      )}
      {error && <p className="mt-2 text-[12px] text-overdue">{error}</p>}
    </div>
  );
}
