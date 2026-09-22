"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { inputClass, buttonPrimaryClass } from "@/lib/ui/styles";
import { StepBadge } from "./StepBadge";

/**
 * Organisation setup: four questions, and the one that matters most is "what
 * kind of business is this?".
 *
 * The choices are NOT hardcoded here — they are read from industry_templates,
 * so adding an industry is an INSERT in a seed rather than an edit to this
 * file. That is the whole architecture, visible in one prop.
 *
 * Country drives the defaults rather than asking five separate questions:
 * picking India sets INR, an April financial year and split-rate GST in one
 * go, and all of it stays editable.
 */
const COUNTRY_DEFAULTS: Record<
  string,
  { label: string; currency: string; locale: string; timezone: string; fyStart: number; regime: "none" | "single_rate" | "split_rate"; rate: number; taxIdKind: string }
> = {
  IN: { label: "India", currency: "INR", locale: "en-IN", timezone: "Asia/Kolkata", fyStart: 4, regime: "split_rate", rate: 18, taxIdKind: "GSTIN" },
  GB: { label: "United Kingdom", currency: "GBP", locale: "en-GB", timezone: "Europe/London", fyStart: 1, regime: "single_rate", rate: 20, taxIdKind: "VAT" },
  AE: { label: "United Arab Emirates", currency: "AED", locale: "en-AE", timezone: "Asia/Dubai", fyStart: 1, regime: "single_rate", rate: 5, taxIdKind: "TRN" },
  US: { label: "United States", currency: "USD", locale: "en-US", timezone: "America/New_York", fyStart: 1, regime: "none", rate: 0, taxIdKind: "EIN" },
};

export interface IndustryTemplate {
  key: string;
  label: string;
  description: string;
}

export function StartForm({
  templates,
  icons,
}: {
  templates: IndustryTemplate[];
  /**
   * One icon per template key, keyed the same way. Resolved by the caller
   * (the page, not this component) so this file never has to know what
   * "freight" or "scrap" is — same reason it reads `templates` from a prop
   * rather than a hardcoded list.
   */
  icons?: Record<string, ReactNode>;
}) {
  const router = useRouter();
  // Internal to this one component rather than two routes/pages: the
  // organisation is created exactly once, on the final submit, so there is
  // nothing partial to leave behind if someone closes the tab between step
  // 2 and step 3 — they just land back on step 2 next time.
  const [step, setStep] = useState<2 | 3>(2);
  const [country, setCountry] = useState("IN");
  const [templateKey, setTemplateKey] = useState(templates[0]?.key ?? "generic");
  const [name, setName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [region, setRegion] = useState("");
  const [invoicePrefix, setInvoicePrefix] = useState("INV");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const d = COUNTRY_DEFAULTS[country];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const res = await fetch("/api/organisations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        legal_name: name,
        country_code: country,
        base_currency: d.currency,
        region_code: region || null,
        locale: d.locale,
        timezone: d.timezone,
        fiscal_year_start_month: d.fyStart,
        tax_regime: d.regime,
        default_tax_rate_pct: d.rate,
        tax_id: taxId || null,
        tax_id_kind: taxId ? d.taxIdKind : null,
        template_key: templateKey,
        invoice_prefix: invoicePrefix || "INV",
      }),
    });
    const body = await res.json();

    if (!res.ok) {
      setSaving(false);
      setError(body.error ?? "Something went wrong. Please try again.");
      return;
    }
    const vertical = body.vertical as string | undefined;
    router.push(vertical && vertical !== "shared" ? `/${vertical}/dashboard` : "/dashboard");
    router.refresh();
  }

  if (step === 2) {
    return (
      <div className="space-y-6">
        <div>
          <StepBadge current={2} total={3} />
          <h1 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.01em] text-ink">
            What kind of business is this?
          </h1>
          <p className="mt-2 max-w-[52ch] text-[14px] leading-[1.55] text-ink-2">
            Sets up what you record against each job — the fields, the pricing, the
            document types. You can change any of it later.
          </p>
        </div>

        <div className="grid gap-2.5 min-[520px]:grid-cols-2 min-[820px]:grid-cols-3">
          {templates.map((t) => {
            const active = templateKey === t.key;
            return (
              <label
                key={t.key}
                className={`flex cursor-pointer gap-3 rounded-[10px] border p-3.5 transition-colors duration-150 ${
                  active ? "border-ink bg-line-soft" : "border-line bg-white hover:border-ink-3"
                }`}
              >
                <input
                  type="radio"
                  name="template"
                  value={t.key}
                  checked={active}
                  onChange={() => setTemplateKey(t.key)}
                  className="sr-only"
                />
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-md ${
                    active ? "bg-ink text-white" : "bg-line-soft text-ink-2"
                  }`}
                >
                  {icons?.[t.key] ?? <Sparkles className="size-4" strokeWidth={1.75} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium text-ink">{t.label}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-[1.5] text-ink-2">{t.description}</span>
                </span>
              </label>
            );
          })}
        </div>

        <button type="button" onClick={() => setStep(3)} className={buttonPrimaryClass}>
          Continue
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div>
        <StepBadge current={3} total={3} />
        <h1 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.01em] text-ink">
          A few details about {templates.find((t) => t.key === templateKey)?.label.toLowerCase() ?? "your business"}.
        </h1>
        <p className="mt-2 max-w-[52ch] text-[14px] leading-[1.55] text-ink-2">
          Everything here can be changed later from Settings.
        </p>
      </div>

      <div>
        <label htmlFor="name" className="mb-1.5 block text-[13px] font-medium text-ink">
          Business name
        </label>
        <input id="name" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </div>

      <div className="space-y-4 rounded-[10px] border border-line bg-white p-4">
        <div>
          <label htmlFor="country" className="mb-1.5 block text-[13px] font-medium text-ink">
            Country
          </label>
          <select id="country" value={country} onChange={(e) => setCountry(e.target.value)} className={inputClass}>
            {Object.entries(COUNTRY_DEFAULTS).map(([code, c]) => (
              <option key={code} value={code}>{c.label}</option>
            ))}
          </select>
          <p className="mt-1.5 text-[12.5px] text-ink-3">
            Sets your currency to {d.currency}, your financial year to start in month {d.fyStart}, and your
            tax to {d.regime === "none" ? "none" : `${d.rate}% ${d.regime === "split_rate" ? "GST" : "VAT"}`}.
          </p>
        </div>

        {d.regime === "split_rate" && (
          <div>
            <label htmlFor="region" className="mb-1.5 block text-[13px] font-medium text-ink">
              State code
            </label>
            <input
              id="region"
              value={region}
              onChange={(e) => setRegion(e.target.value.toUpperCase())}
              className={`${inputClass} font-mono uppercase`}
              placeholder="KA"
            />
            <p className="mt-1.5 text-[12.5px] text-ink-3">
              Decides whether tax splits in two or combines into one on each document.
            </p>
          </div>
        )}

        <div>
          <label htmlFor="taxId" className="mb-1.5 block text-[13px] font-medium text-ink">
            {d.taxIdKind} <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <input
            id="taxId"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value.toUpperCase())}
            className={`${inputClass} font-mono uppercase`}
          />
        </div>
      </div>

      <div className="space-y-4 rounded-[10px] border border-line bg-white p-4">
        <div>
          <label htmlFor="invoicePrefix" className="mb-1.5 block text-[13px] font-medium text-ink">
            Invoice numbering prefix
          </label>
          <input
            id="invoicePrefix"
            value={invoicePrefix}
            onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="INV"
            className={`${inputClass} w-32 font-mono uppercase`}
          />
          <p className="mt-1.5 text-[12.5px] text-ink-3">
            Your first invoice will be numbered {invoicePrefix || "INV"}-{new Date().getFullYear()}-000001.
          </p>
        </div>

        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-ink">
            Logo <span className="font-normal text-ink-3">(optional)</span>
          </span>
          <div className="flex items-center gap-3 rounded-[10px] border border-dashed border-line bg-paper p-3.5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-line bg-white text-[10px] text-ink-3">
              No logo
            </div>
            <p className="text-[12.5px] text-ink-3">
              Add this after setup, from Settings — it prints top-left on every invoice.
            </p>
          </div>
        </div>
      </div>

      {error && <p className="rounded-md bg-overdue-tint p-3 text-[13px] text-overdue">{error}</p>}

      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setStep(2)} className="text-[13.5px] text-ink-2 hover:text-ink">
          ← Back
        </button>
        <button type="submit" disabled={saving} className={buttonPrimaryClass}>
          {saving ? "Setting up…" : "Finish setup"}
        </button>
      </div>
    </form>
  );
}
