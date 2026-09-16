"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, buttonPrimaryClass } from "@/lib/ui/styles";

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

export function StartForm({ templates }: { templates: IndustryTemplate[] }) {
  const router = useRouter();
  const [country, setCountry] = useState("IN");
  const [templateKey, setTemplateKey] = useState(templates[0]?.key ?? "generic");
  const [name, setName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [region, setRegion] = useState("");
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
      }),
    });
    const body = await res.json();

    if (!res.ok) {
      setSaving(false);
      setError(body.error ?? "Something went wrong. Please try again.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <h1 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.01em] text-ink">
        Let&apos;s set up your business.
      </h1>
      <p className="max-w-[52ch] text-[14px] leading-[1.55] text-ink-2">
        A few questions. Everything else follows from your answers, and all of it can be
        changed later.
      </p>

      <div>
        <label htmlFor="name" className="mb-1.5 block text-[13px] font-medium text-ink">
          Business name
        </label>
        <input id="name" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </div>

      <div>
        <span className="mb-1.5 block text-[13px] font-medium text-ink">What kind of business is this?</span>
        <div className="space-y-2">
          {templates.map((t) => (
            <label
              key={t.key}
              className={`flex cursor-pointer gap-3 rounded-md border p-3.5 transition-colors duration-150 ${
                templateKey === t.key ? "border-brand bg-brand-tint" : "border-line bg-white hover:border-ink-3"
              }`}
            >
              <input
                type="radio"
                name="template"
                value={t.key}
                checked={templateKey === t.key}
                onChange={() => setTemplateKey(t.key)}
                className="mt-0.5 size-4 shrink-0 accent-brand"
              />
              <span>
                <span className="block text-[14px] font-medium text-ink">{t.label}</span>
                <span className="mt-0.5 block text-[12.5px] leading-[1.5] text-ink-2">{t.description}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-[12.5px] text-ink-3">
          Sets up what you record against each job. You can change any of it later.
        </p>
      </div>

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

      {error && <p className="rounded-md bg-overdue-tint p-3 text-[13px] text-overdue">{error}</p>}

      <button type="submit" disabled={saving} className={buttonPrimaryClass}>
        {saving ? "Setting up…" : "Finish setup"}
      </button>
    </form>
  );
}
