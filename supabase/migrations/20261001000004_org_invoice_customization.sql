-- ═══════════════════════════════════════════════════════════════════════════
-- What prints on THIS organisation's invoices, beyond which template renders
-- them (20261001000003_org_invoice_template.sql). Two knobs, deliberately
-- small rather than an open column-builder:
--
--   invoice_show_hsn — HSN/SAC is a GST-specific line-item code. An org
--   outside India's HSN/SAC regime has nothing meaningful to put there, and
--   showing an empty "HSN/SAC" caption on every line reads as broken, not
--   optional. Off by default is wrong too — most seeded orgs ARE India/GST —
--   so this defaults true and is a plain per-org toggle, not inferred from
--   country_code (an org can register for HSN codes without being Indian,
--   or vice versa; inferring it would be one more silent branch on country).
--
--   invoice_terms — standing "Terms & Conditions" text, printed on every
--   invoice from here on. Distinct from `documents.notes`, which is a
--   per-document note frozen into that one document's own issued_snapshot
--   at issue time — this is read live, same reasoning as invoice_template
--   and logo_path: cosmetic/standing configuration, not a fact about any
--   one transaction, so editing it changes how every past invoice reprints.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.organisations
  add column if not exists invoice_show_hsn boolean not null default true;

alter table public.organisations
  add column if not exists invoice_terms text;

comment on column public.organisations.invoice_show_hsn is
  'Whether the HSN/SAC line prints under a line item that has one. Set via set_org_invoice_customization(), never written directly.';
comment on column public.organisations.invoice_terms is
  'Standing Terms & Conditions text, printed on every invoice/bill. Set via set_org_invoice_customization(), never written directly.';

-- ───────────────────────────────────────────────────────────────────────────
-- set_org_invoice_customization: owner-only, same guard shape as
-- set_org_invoice_template / set_org_logo.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.set_org_invoice_customization(
  p_show_hsn boolean,
  p_terms    text default null
)
returns table (org_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_uid uuid := auth.uid();
begin
  if v_org is null then
    raise exception 'set_org_invoice_customization: no organisation for this account' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.org_id = v_org and p.role = 'owner') then
    raise exception 'set_org_invoice_customization: only an owner can change invoice settings' using errcode = '42501';
  end if;
  if p_terms is not null and length(p_terms) > 2000 then
    raise exception 'set_org_invoice_customization: terms text is too long' using errcode = '22001';
  end if;

  update public.organisations
     set invoice_show_hsn = p_show_hsn,
         invoice_terms    = nullif(trim(coalesce(p_terms, '')), '')
   where id = v_org;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'organisation.invoice_customization_set', 'organisation', v_org,
          jsonb_build_object('invoice_show_hsn', p_show_hsn, 'invoice_terms', p_terms));

  return query select v_org;
end;
$$;

revoke execute on function public.set_org_invoice_customization(boolean, text) from public;
grant  execute on function public.set_org_invoice_customization(boolean, text) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.set_org_invoice_customization(boolean, text);
-- alter table public.organisations drop column if exists invoice_terms;
-- alter table public.organisations drop column if exists invoice_show_hsn;
