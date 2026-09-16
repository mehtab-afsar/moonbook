import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const REGIME_LABEL: Record<string, string> = {
  none: "No tax charged",
  single_rate: "One rate, one component (VAT-style)",
  split_rate: "One rate split in two within your own region (GST-style)",
};

const CADENCE_LABEL: Record<string, string> = {
  never: "never resets",
  fiscal_year: "resets each financial year",
  calendar_year: "resets each calendar year",
  monthly: "resets monthly",
};

/**
 * What this business is configured as.
 *
 * Read-only, deliberately. Editing an organisation's tax regime or fiscal year
 * after it has issued documents is not a form field — it changes how numbers
 * already in the book should be read, and the safe version of it needs a
 * migration path per setting. Until that exists, this page shows the
 * configuration and says plainly which parts are fixed.
 *
 * The activity types below are the interesting half: they are rows this
 * organisation owns, copied from a template at signup, and they are what makes
 * this business's Moonbook different from every other one.
 */
export default async function SettingsPage() {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");

  const supabase = await createClient();
  const [{ data: org }, { data: types, error }, { data: series }] = await Promise.all([
    supabase
      .from("organisations")
      .select(
        "legal_name, country_code, region_code, base_currency, locale, timezone, fiscal_year_start_month, tax_regime, default_tax_rate_pct, tax_id, tax_id_kind, address",
      )
      .eq("id", auth.ctx.orgId)
      .single(),
    supabase
      .from("activity_types")
      // FK named: activity_fields reaches activity_types by two paths.
      .select(
        "id, key, label_singular, label_plural, direction, pricing_strategy, archived_at, sort_order, activity_fields!activity_fields_activity_type_id_fkey(key, label, field_type, is_required, is_reportable, show_on_document, archived_at, sort_order)",
      )
      .not("org_id", "is", null)
      .order("sort_order"),
    supabase
      .from("document_series")
      .select("doc_kind, prefix, is_self_numbered, reset_cadence")
      .order("doc_kind"),
  ]);

  if (error) throw new Error(`Could not load your configuration: ${error.message}`);

  const monthName = new Intl.DateTimeFormat(org?.locale ?? "en", { month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(2026, (org?.fiscal_year_start_month ?? 1) - 1, 1)));

  return (
    <div className="max-w-[900px] space-y-8 p-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Settings</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">
          How this business is set up. Everything below was decided at signup and can be
          changed — ask us, for now, because changing some of it affects how documents you
          have already issued should be read.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-[15px] font-medium text-ink">Business</h2>
        <dl className="grid gap-x-8 gap-y-3 rounded-[10px] border border-line bg-white p-5 text-[13.5px] min-[640px]:grid-cols-2">
          <Row label="Name" value={org?.legal_name ?? "—"} />
          <Row label="Country" value={org?.country_code ?? "—"} />
          {org?.region_code && <Row label="Region" value={org.region_code} />}
          <Row label={org?.tax_id_kind ?? "Tax ID"} value={org?.tax_id ?? "Not registered"} mono />
          {org?.address && <Row label="Address" value={org.address} />}
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-medium text-ink">Money and dates</h2>
        <dl className="grid gap-x-8 gap-y-3 rounded-[10px] border border-line bg-white p-5 text-[13.5px] min-[640px]:grid-cols-2">
          <Row label="Currency" value={org?.base_currency ?? "—"} mono />
          <Row label="Number and date format" value={org?.locale ?? "—"} mono />
          <Row label="Time zone" value={org?.timezone ?? "—"} mono />
          <Row label="Financial year starts" value={monthName} />
        </dl>
        <p className="text-[12.5px] text-ink-3">
          The financial year decides which series numbers an invoice — a document dated
          before the year turns takes the earlier year&apos;s series, even if it is entered later.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-medium text-ink">Tax</h2>
        <dl className="grid gap-x-8 gap-y-3 rounded-[10px] border border-line bg-white p-5 text-[13.5px] min-[640px]:grid-cols-2">
          <Row label="How tax works here" value={REGIME_LABEL[org?.tax_regime ?? "none"]} />
          <Row label="Default rate" value={`${Number(org?.default_tax_rate_pct ?? 0)}%`} mono />
        </dl>
        {org?.tax_regime === "split_rate" && (
          <p className="text-[12.5px] text-ink-3">
            A customer in {org.region_code ?? "your own region"} is charged two components at
            half the rate each; a customer anywhere else is charged one combined component at
            the full rate. Both come to the same total.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-medium text-ink">Numbering</h2>
        <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
          <table className="w-full text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-line-soft text-[12px] uppercase tracking-wide text-ink-3">
                <th className="px-5 py-3 font-medium">Document</th>
                <th className="px-5 py-3 font-medium">Prefix</th>
                <th className="px-5 py-3 font-medium">Numbering</th>
              </tr>
            </thead>
            <tbody>
              {(series ?? []).map((s) => (
                <tr key={s.doc_kind} className="border-b border-line-soft last:border-b-0">
                  <td className="px-5 py-3 text-ink">{s.doc_kind.replace("_", " ")}</td>
                  <td className="px-5 py-3 font-mono text-ink-2">{s.prefix}</td>
                  <td className="px-5 py-3 text-ink-2">
                    {s.is_self_numbered
                      ? `Numbered by you, ${CADENCE_LABEL[s.reset_cadence]}`
                      : "Numbered by the other party"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12.5px] text-ink-3">
          Numbers are gapless: one is only spent when a document is actually issued, so a
          failed attempt never punches a hole in your book.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-medium text-ink">What you record</h2>
        <p className="text-[13px] text-ink-2">
          These came from the kind of business you chose at signup. They are yours — nothing
          here is shared with any other business on Moonbook, and changing them changes only
          what you see.
        </p>
        {(types ?? []).map((t) => {
          const fields = ((t.activity_fields ?? []) as unknown as {
            key: string; label: string; field_type: string; is_required: boolean;
            is_reportable: boolean; show_on_document: boolean; archived_at: string | null;
            sort_order: number;
          }[])
            .filter((f) => f.archived_at === null)
            .sort((a, b) => a.sort_order - b.sort_order);

          return (
            <div key={t.id} className="rounded-[10px] border border-line bg-white p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[14.5px] font-medium text-ink">{t.label_plural}</h3>
                <span className="font-mono text-[12px] text-ink-3">{t.key}</span>
              </div>
              {fields.length === 0 ? (
                <p className="mt-2 text-[13px] text-ink-3">No extra fields — just an amount.</p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {fields.map((f) => (
                    <li key={f.key} className="flex flex-wrap items-baseline gap-2 text-[13px]">
                      <span className="text-ink">{f.label}</span>
                      <span className="font-mono text-[12px] text-ink-3">{f.field_type}</span>
                      {f.is_required && <Tag>required</Tag>}
                      {f.is_reportable && <Tag>grouped in reports</Tag>}
                      {!f.show_on_document && <Tag>not printed</Tag>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[12.5px] text-ink-3">{label}</dt>
      <dd className={`mt-0.5 text-ink ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-line-soft px-2 py-0.5 text-[11px] text-ink-2">{children}</span>
  );
}
