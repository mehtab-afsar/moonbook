-- ═══════════════════════════════════════════════════════════════════════════
-- 12 · Industry templates
--
-- THE POINT OF THE WHOLE ARCHITECTURE, made concrete: an industry is a set of
-- ROWS, not a branch in the code. Adding one is an INSERT into this migration's
-- seed. No deploy, no migration to the tables, no TypeScript.
--
-- A configurable system with a blank first screen is unusable — nobody wants
-- to design a billing schema, they want to invoice someone by lunchtime. So a
-- template is picked at signup and COPIED into the organisation, which then
-- owns its copy outright and can edit it freely. Later changes to the system
-- template never reach back into an org that already copied it: a customer's
-- configuration is theirs, and silently rewriting it would be worse than
-- leaving a mistake in place.
--
-- ONLY TWO SHIP HERE, deliberately. Writing six means guessing six sets of
-- field names, and a wrong guess is worse than an absent one because
-- customers will use it and then their data has to be migrated to fix it.
-- Each further template gets written with its first real customer in the room.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.industry_templates (
  key         text primary key
              constraint industry_templates_key_fmt_chk check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label       text not null,
  description text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

comment on table public.industry_templates is
  'The industries offered at signup. Rows, not code — adding one is an INSERT.';

alter table public.industry_templates enable row level security;

-- DELIBERATELY TENANT-AGNOSTIC. Every other policy in this schema fences rows
-- to the caller's organisation; this one cannot, because a user must be able
-- to read the list BEFORE they have an organisation at all — choosing from it
-- is what creates one. The table holds no tenant data, only the catalogue of
-- industries on offer.
--
-- The exception is declared in __tests__/rls-policies.test.ts rather than
-- hidden, and that test asserts the other half of the bargain: a
-- tenant-agnostic table must be strictly read-only.
drop policy if exists "industry_templates_select" on public.industry_templates;
create policy "industry_templates_select" on public.industry_templates
  for select to authenticated using (true);

revoke all on public.industry_templates from anon;
grant select on public.industry_templates to authenticated;
-- Granted here rather than in migration 11: a table's grants belong with the
-- table, so a new one cannot be created and then forgotten. Enforced by
-- __tests__/anon-grants.test.ts.
grant select on public.industry_templates to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- The templates themselves.
--
-- Both ship with `manual` pricing on purpose. A quantity_rate type whose rate
-- comes from a details field reads that field as MINOR UNITS, so a template
-- cannot offer "rate per day" as a user-entered number without teaching every
-- customer that 2500 means twenty-five rupees. The honest fix is a `money`
-- field type that knows the currency; until a customer needs per-record rates,
-- a template that would need one uses a configured rate_minor or stays manual.
-- ───────────────────────────────────────────────────────────────────────────
insert into public.industry_templates (key, label, description, sort_order) values
  ('generic', 'Something else',
   'A single, open service line. Start here and shape it as you learn what you record.', 99),
  ('freight', 'Freight & logistics',
   'Trips with an origin, a destination and a vehicle. Bill the broker or the consignee.', 0)
on conflict (key) do update
  set label = excluded.label,
      description = excluded.description,
      sort_order = excluded.sort_order;

-- System-owned activity types: org_id IS NULL. The composite FK on activities
-- makes it structurally impossible to record work against one of these without
-- copying it into an organisation first.
insert into public.activity_types
  (org_id, template_key, key, label_singular, label_plural, direction, pricing_strategy, pricing_config, dim1_field_key, sort_order)
values
  (null, 'generic', 'service', 'Service', 'Services', 'receivable', 'manual', '{}'::jsonb, null, 0),
  (null, 'freight', 'trip',    'Trip',    'Trips',    'receivable', 'manual', '{}'::jsonb, 'load_type', 0)
on conflict (key) where org_id is null do update
  set label_singular = excluded.label_singular,
      label_plural   = excluded.label_plural,
      dim1_field_key = excluded.dim1_field_key;

insert into public.activity_fields
  (activity_type_id, org_id, key, label, field_type, options, is_required, is_reportable, show_on_document, sort_order)
select t.id, null, f.key, f.label, f.field_type, f.options, f.is_required, f.is_reportable, f.show_on_document, f.sort_order
  from public.activity_types t
  join (values
    -- generic
    ('service', 'description', 'Description', 'long_text', '[]'::jsonb, false, false, true,  0),
    -- freight
    ('trip',    'origin',      'Origin',      'text',      '[]'::jsonb, true,  false, true,  0),
    ('trip',    'destination', 'Destination', 'text',      '[]'::jsonb, true,  false, true,  1),
    ('trip',    'vehicle_no',  'Vehicle no.', 'text',      '[]'::jsonb, false, false, true,  2),
    ('trip',    'load_type',   'Load type',   'select',
       '["Full truckload","Part load","Express"]'::jsonb,               false, true,  true,  3)
  ) as f(type_key, key, label, field_type, options, is_required, is_reportable, show_on_document, sort_order)
    on f.type_key = t.key
 where t.org_id is null
on conflict (activity_type_id, key) do update
  set label = excluded.label, options = excluded.options, sort_order = excluded.sort_order;

-- ───────────────────────────────────────────────────────────────────────────
-- apply_industry_template: copy a template into the caller's organisation.
--
-- A deep copy with fresh ids, not a reference. The org owns what it gets.
-- Safe to call more than once and safe to call for a second industry: types
-- the org already has (by key) are skipped rather than duplicated or
-- overwritten, so a customer who has edited their copy never loses the edit.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.apply_industry_template(p_template_key text)
returns table (types_added integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org   uuid := (select public.current_org_id());
  v_uid   uuid := auth.uid();
  v_added integer := 0;
  v_type  record;
  v_new   uuid;
begin
  if v_org is null then
    raise exception 'apply_industry_template: no organisation for this account' using errcode = '28000';
  end if;
  if not (select public.has_role('owner')) then
    raise exception 'apply_industry_template: requires the owner role' using errcode = '42501';
  end if;
  if not exists (select 1 from public.industry_templates where key = p_template_key) then
    raise exception 'apply_industry_template: no template called %', p_template_key using errcode = 'P0002';
  end if;

  for v_type in
    select * from public.activity_types
     where org_id is null and template_key = p_template_key
     order by sort_order
  loop
    -- Already has a type with this key: leave the org's own version alone.
    continue when exists (
      select 1 from public.activity_types
       where org_id = v_org and key = v_type.key
    );

    insert into public.activity_types (
      org_id, template_key, key, label_singular, label_plural, direction,
      pricing_strategy, pricing_config, dim1_field_key, uses_period,
      uses_job_margin, sort_order
    ) values (
      v_org, v_type.template_key, v_type.key, v_type.label_singular, v_type.label_plural,
      v_type.direction, v_type.pricing_strategy, v_type.pricing_config, v_type.dim1_field_key,
      v_type.uses_period, v_type.uses_job_margin, v_type.sort_order
    )
    returning id into v_new;

    insert into public.activity_fields (
      activity_type_id, org_id, key, label, field_type, options,
      is_required, is_reportable, show_on_document, sort_order
    )
    select v_new, v_org, f.key, f.label, f.field_type, f.options,
           f.is_required, f.is_reportable, f.show_on_document, f.sort_order
      from public.activity_fields f
     where f.activity_type_id = v_type.id and f.archived_at is null;

    v_added := v_added + 1;
  end loop;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'industry_template.applied', 'organisation', v_org,
          jsonb_build_object('template_key', p_template_key, 'types_added', v_added));

  return query select v_added;
end;
$$;

comment on function public.apply_industry_template(text) is
  'Owner-only. Deep-copies a system industry template into the caller''s organisation with fresh ids. Skips types the org already has, so it is safe to re-run and safe to add a second industry.';

revoke execute on function public.apply_industry_template(text) from public;
grant  execute on function public.apply_industry_template(text) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.apply_industry_template(text);
-- delete from public.activity_fields where org_id is null;
-- delete from public.activity_types  where org_id is null;
-- drop table if exists public.industry_templates;
