import Link from "next/link";
import { redirect } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { ImageIcon, Building2, CalendarClock, Percent, Hash, ListChecks, Link2, UserCircle, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";
import { LogoUploader } from "@/features/settings/components/LogoUploader";
import { TemplatePicker } from "@/features/settings/components/TemplatePicker";
import { InvoiceCustomization } from "@/features/settings/components/InvoiceCustomization";
import { GstnConnectionForm, type GstnConnectionState } from "@/features/settings/components/GstnConnectionForm";
import { ActivityFieldsEditor, type ActivityFieldRow } from "@/features/settings/components/ActivityFieldsEditor";
import { RelationshipsEditor, type LinkTypeRow } from "@/features/settings/components/RelationshipsEditor";
import { ActivityTypeHeader, AddActivityTypeForm } from "@/features/settings/components/ActivityTypesEditor";
import type { FieldType } from "@/lib/domain";
import { TeamInvites } from "@/features/settings/components/TeamInvites";
import { SignOutButton } from "@/features/settings/components/SignOutButton";

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
  const [{ data: org }, { data: types, error }, { data: series }, { data: invites }, { data: gstnConnection, error: gstnError }, { data: linkTypes, error: linkTypesError }] = await Promise.all([
    supabase
      .from("organisations")
      .select(
        "legal_name, country_code, region_code, base_currency, locale, timezone, fiscal_year_start_month, tax_regime, default_tax_rate_pct, tax_id, tax_id_kind, address, logo_path, invoice_template, invoice_show_hsn, invoice_terms",
      )
      .eq("id", auth.ctx.orgId)
      .single(),
    supabase
      .from("activity_types")
      // FK named: activity_fields reaches activity_types by two paths.
      .select(
        "id, key, label_singular, label_plural, direction, pricing_strategy, uses_period, uses_job_margin, archived_at, sort_order, activity_fields!activity_fields_activity_type_id_fkey(id, key, label, field_type, options, is_required, is_reportable, show_on_document, archived_at, sort_order)",
      )
      .not("org_id", "is", null)
      .order("sort_order"),
    supabase
      .from("document_series")
      .select("doc_kind, prefix, is_self_numbered, reset_cadence")
      .order("doc_kind"),
    supabase
      .from("org_invites")
      .select("id, email, role, created_at, expires_at, accepted_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("gstn_connections")
      .select("provider, environment, gstin, status")
      .eq("org_id", auth.ctx.orgId)
      .maybeSingle(),
    supabase
      .from("activity_link_types")
      .select("id, key, label, aggregate, from_activity_type_id, to_activity_type_id")
      .eq("org_id", auth.ctx.orgId)
      .is("archived_at", null)
      .order("sort_order"),
  ]);

  if (error) throw new Error(`Could not load your configuration: ${error.message}`);
  if (gstnError) throw new Error(`Could not load your GSTN connection: ${gstnError.message}`);
  if (linkTypesError) throw new Error(`Could not load your relationships: ${linkTypesError.message}`);

  const monthName = new Intl.DateTimeFormat(org?.locale ?? "en", { month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(2026, (org?.fiscal_year_start_month ?? 1) - 1, 1)));
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: org?.timezone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  return (
    <div className="mx-auto max-w-[1200px] space-y-8 p-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">Settings</h1>
        <p className="mt-1 max-w-[68ch] text-[13.5px] text-ink-2">
          How this business is set up. Everything below was decided at signup — ask us to
          change it, since some of it affects how documents you&apos;ve already issued are read.
        </p>
      </header>

      <SettingsSection icon={ImageIcon} title="Branding">
        <div className="rounded-[10px] border border-line bg-white p-5 space-y-5">
          <LogoUploader hasLogo={Boolean(org?.logo_path)} isOwner={auth.ctx.role === "owner"} />
          <div className="border-t border-line-soft pt-5">
            <TemplatePicker
              current={org?.invoice_template ?? "classic"}
              isOwner={auth.ctx.role === "owner"}
            />
          </div>
          <div className="border-t border-line-soft pt-5">
            <InvoiceCustomization
              showHsn={org?.invoice_show_hsn ?? true}
              terms={org?.invoice_terms ?? null}
              isOwner={auth.ctx.role === "owner"}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection icon={Building2} title="Business">
        <dl className="divide-y divide-line-soft rounded-[10px] border border-line bg-white">
          <Field label="Name" value={org?.legal_name ?? "—"} />
          <Field label="Country" value={org?.country_code ?? "—"} mono />
          {org?.region_code && <Field label="Region" value={org.region_code} mono />}
          <Field label={org?.tax_id_kind ?? "Tax ID"} value={org?.tax_id ?? "Not registered"} mono />
          {org?.address && <Field label="Address" value={org.address} />}
        </dl>
      </SettingsSection>

      <SettingsSection
        icon={CalendarClock}
        title="Money and dates"
        footnote="The financial year decides which series numbers an invoice — a document dated before the year turns takes the earlier year's series, even if it is entered later."
      >
        <dl className="divide-y divide-line-soft rounded-[10px] border border-line bg-white">
          <Field label="Currency" value={org?.base_currency ?? "—"} mono />
          <Field label="Number and date format" value={org?.locale ?? "—"} mono />
          <Field label="Time zone" value={org?.timezone ?? "—"} mono />
          <Field label="Financial year starts" value={monthName} />
        </dl>
      </SettingsSection>

      <SettingsSection
        icon={Percent}
        title="Tax"
        footnote={
          org?.tax_regime === "split_rate"
            ? `A customer in ${org.region_code ?? "your own region"} is charged two components at half the rate each; a customer anywhere else is charged one combined component at the full rate. Both come to the same total.`
            : undefined
        }
      >
        <dl className="divide-y divide-line-soft rounded-[10px] border border-line bg-white">
          <Field label="How tax works here" value={REGIME_LABEL[org?.tax_regime ?? "none"]} />
          <Field label="Default rate" value={`${Number(org?.default_tax_rate_pct ?? 0)}%`} mono />
        </dl>
      </SettingsSection>

      {org?.tax_regime === "split_rate" && (
        <SettingsSection icon={Percent} title="E-way bill & e-invoice (GSTN)">
          <div className="rounded-[10px] border border-line bg-white p-5">
            <GstnConnectionForm
              current={gstnConnection as GstnConnectionState | null}
              orgGstin={org?.tax_id ?? null}
              isOwner={auth.ctx.role === "owner"}
            />
          </div>
        </SettingsSection>
      )}

      <SettingsSection
        icon={Hash}
        title="Numbering"
        footnote="Numbers are gapless: one is only spent when a document is actually issued, so a failed attempt never punches a hole in your book."
      >
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
                  <td className="px-5 py-3 capitalize text-ink">{s.doc_kind.replace("_", " ")}</td>
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
      </SettingsSection>

      <SettingsSection
        icon={ListChecks}
        title="What you record"
        footnote="These came from the kind of business you chose at signup. They are yours — nothing here is shared with any other business on Moonbook, and changing them changes only what you see."
        footnoteFirst
      >
        <div className="space-y-3">
          {(types ?? []).map((t) => {
            const fields: ActivityFieldRow[] = ((t.activity_fields ?? []) as unknown as {
              id: string; key: string; label: string; field_type: string; options: string[] | null;
              is_required: boolean; is_reportable: boolean; show_on_document: boolean;
              archived_at: string | null; sort_order: number;
            }[])
              .filter((f) => f.archived_at === null)
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((f) => ({
                id: f.id, key: f.key, label: f.label, field_type: f.field_type as FieldType,
                options: f.options ?? [], is_required: f.is_required, is_reportable: f.is_reportable,
                show_on_document: f.show_on_document,
              }));

            return (
              <div key={t.id} className="rounded-[10px] border border-line bg-white p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-3">
                    <h3 className="text-[14.5px] font-medium text-ink">{t.label_plural}</h3>
                    <span className="font-mono text-[12px] text-ink-3">{t.key}</span>
                  </div>
                  <ActivityTypeHeader
                    type={{
                      id: t.id, label_singular: t.label_singular, label_plural: t.label_plural,
                      direction: t.direction as "receivable" | "payable",
                      pricing_strategy: t.pricing_strategy as "manual" | "flat" | "quantity_rate",
                      uses_period: t.uses_period, uses_job_margin: t.uses_job_margin,
                    }}
                    isOwner={auth.ctx.role === "owner"}
                  />
                </div>
                <ActivityFieldsEditor
                  activityTypeId={t.id}
                  fields={fields}
                  isOwner={auth.ctx.role === "owner"}
                />
              </div>
            );
          })}
          <AddActivityTypeForm isOwner={auth.ctx.role === "owner"} />
        </div>
      </SettingsSection>

      <SettingsSection
        icon={Link2}
        title="Relationships"
        footnote="How your activity types connect to each other — e.g. a delivery referencing the purchase order it fulfils. A rollup, when set, is a fixed sum or count, never a formula."
        footnoteFirst
      >
        <RelationshipsEditor
          types={(types ?? []).map((t) => ({ id: t.id, label_plural: t.label_plural }))}
          linkTypes={(linkTypes ?? []) as LinkTypeRow[]}
          isOwner={auth.ctx.role === "owner"}
        />
      </SettingsSection>

      <SettingsSection icon={Users} title="Team">
        <TeamInvites
          invites={(invites ?? []).map((i) => ({ ...i, role: i.role as "owner" | "staff" }))}
          isOwner={auth.ctx.role === "owner"} today={today}
        />
        <p className="text-[13px] text-ink-2">
          <Link href="/settings/activity" className="font-medium text-brand hover:underline">
            View activity log →
          </Link>{" "}
          — who&apos;s done what, across the whole team.
        </p>
      </SettingsSection>

      <SettingsSection icon={UserCircle} title="Account">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line bg-white p-5">
          <div>
            <p className="text-[13.5px] font-medium text-ink">{auth.ctx.fullName ?? auth.ctx.role}</p>
            <p className="mt-0.5 text-[12.5px] text-ink-3">Signed in to {org?.legal_name ?? "this business"}.</p>
          </div>
          <SignOutButton />
        </div>
      </SettingsSection>
    </div>
  );
}

/** One config topic: an icon-labeled heading, its content, and an optional explanatory footnote — the one shape every section below shares. */
function SettingsSection({
  icon: Icon,
  title,
  footnote,
  footnoteFirst,
  children,
}: {
  icon: LucideIcon;
  title: string;
  footnote?: string;
  /** "What you record" reads better with its context before the list; every other section explains itself after. */
  footnoteFirst?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-tint text-brand">
          <Icon className="size-[15px]" strokeWidth={1.75} />
        </span>
        <h2 className="text-[15px] font-medium text-ink">{title}</h2>
      </div>
      {footnote && footnoteFirst && <p className="text-[13px] text-ink-2">{footnote}</p>}
      {children}
      {footnote && !footnoteFirst && <p className="text-[12.5px] text-ink-3">{footnote}</p>}
    </section>
  );
}

/** One label/value row in a Business/Money/Tax card — a single-column list with dividers, not a two-column grid, so a long value never crowds its label. */
function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 px-5 py-3 text-[13.5px]">
      <dt className="text-ink-2">{label}</dt>
      <dd className={`text-right text-ink ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
