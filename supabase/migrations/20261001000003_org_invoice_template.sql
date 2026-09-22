-- ═══════════════════════════════════════════════════════════════════════════
-- Which visual invoice template this organisation prints with. Same shape
-- as logo_path (20260930000002_org_logo.sql): a plain column, changed only
-- through a SECURITY DEFINER RPC, owner-only. The template itself lives in
-- code (lib/pdf/templates/registry.ts) — this column just names a key from
-- that registry, so an old or unrecognised value can never break rendering;
-- the renderer falls back to the default template instead of erroring.
--
-- Deliberately NOT part of a document's frozen issued_snapshot: the template
-- is cosmetic, not a fact about the transaction (same reasoning as the
-- logo), so switching templates changes how every past document reprints,
-- not just new ones.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.organisations
  add column if not exists invoice_template text not null default 'classic';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organisations_invoice_template_chk') then
    alter table public.organisations
      add constraint organisations_invoice_template_chk
      check (invoice_template in ('classic', 'modern'));
  end if;
end $$;

comment on column public.organisations.invoice_template is
  'Key into lib/pdf/templates/registry.ts. Set via set_org_invoice_template(), never written directly.';

-- ───────────────────────────────────────────────────────────────────────────
-- set_org_invoice_template: owner-only, same guard shape as set_org_logo.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.set_org_invoice_template(
  p_template text
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
    raise exception 'set_org_invoice_template: no organisation for this account' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.org_id = v_org and p.role = 'owner') then
    raise exception 'set_org_invoice_template: only an owner can change the invoice template' using errcode = '42501';
  end if;
  if p_template not in ('classic', 'modern') then
    raise exception 'set_org_invoice_template: unknown template %', p_template using errcode = '22023';
  end if;

  update public.organisations set invoice_template = p_template where id = v_org;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'organisation.invoice_template_set', 'organisation', v_org,
          jsonb_build_object('invoice_template', p_template));

  return query select v_org;
end;
$$;

revoke execute on function public.set_org_invoice_template(text) from public;
grant  execute on function public.set_org_invoice_template(text) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.set_org_invoice_template(text);
-- alter table public.organisations drop constraint if exists organisations_invoice_template_chk;
-- alter table public.organisations drop column if exists invoice_template;
