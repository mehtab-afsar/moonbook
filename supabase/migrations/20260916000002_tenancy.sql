-- ═══════════════════════════════════════════════════════════════════════════
-- 02 · Tenancy, roles, and the audit log
--
-- organisations is the tenant root; profiles maps an auth user to exactly one
-- organisation and one role. Every other table in the schema hangs off org_id
-- and is fenced by RLS.
--
-- Multi-country from day one: an organisation carries its country, currency,
-- locale, timezone, financial-year start month and tax regime. Nothing about
-- India is baked into the schema — CONVENTIONS.md section 9 and 10 explain
-- why money is minor units + a currency column, and why tax components live
-- in their own table rather than as cgst/sgst/igst columns.
--
-- audit_events is created here, before any RPC exists, so that every RPC can
-- log from its FIRST definition. LedgerFlow added auditing in a later
-- migration and had to redefine four functions to do it — the exact
-- superseding churn CONVENTIONS.md section 7 is written to avoid.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- organisations
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.organisations (
  id            uuid primary key default gen_random_uuid(),
  legal_name    text not null
                constraint organisations_name_chk check (length(trim(legal_name)) > 1),

  -- Jurisdiction. region_code is the state/province the org is registered in;
  -- the split_rate tax regime compares it against the counterparty's to decide
  -- whether tax splits in two or combines into one component.
  country_code  char(2) not null
                constraint organisations_country_chk check (country_code ~ '^[A-Z]{2}$'),
  region_code   text,

  -- Money and formatting.
  base_currency char(3) not null
                constraint organisations_currency_chk check (base_currency ~ '^[A-Z]{3}$'),
  locale        text not null default 'en',
  timezone      text not null default 'UTC',

  -- Financial year start, 1..12. fiscal_year_code() (migration 01) reads this
  -- and is deliberately NOT range-checked itself, so the constraint lives here
  -- where a bad value can never be stored.
  fiscal_year_start_month integer not null default 1
                constraint organisations_fy_month_chk
                check (fiscal_year_start_month between 1 and 12),

  -- Tax. A closed set of regimes, each a tested code path in lib/tax/.
  tax_regime    text not null default 'none'
                constraint organisations_tax_regime_chk
                check (tax_regime in ('none', 'single_rate', 'split_rate')),
  default_tax_rate_pct numeric(5,2) not null default 0
                constraint organisations_tax_rate_chk
                check (default_tax_rate_pct >= 0 and default_tax_rate_pct <= 100),

  -- Statutory identifier. Generic by design: GSTIN in India, VAT number in the
  -- UK/EU, TRN in the UAE. Shape validation is per-country in lib/regions/.
  tax_id        text,
  tax_id_kind   text,

  address       text,
  bank_details  jsonb not null default '{}'::jsonb
                constraint organisations_bank_details_chk check (jsonb_typeof(bank_details) = 'object'),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.organisations is 'Tenant root. Every other table is fenced to one of these by RLS.';
comment on column public.organisations.region_code is
  'State/province of registration. The split_rate tax regime compares this against the counterparty''s region to decide whether tax splits into two components.';

drop trigger if exists organisations_updated_at on public.organisations;
create trigger organisations_updated_at before update on public.organisations
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- profiles
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  org_id     uuid not null references public.organisations(id) on delete cascade,
  full_name  text,
  role       text not null default 'staff'
             constraint profiles_role_chk check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_org_idx on public.profiles (org_id);

comment on table public.profiles is 'Staff. One auth user belongs to exactly one organisation, with one role.';

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- audit_events — append-only
--
-- Stricter than LedgerFlow's, deliberately: there is NO insert policy and NO
-- insert grant for any client role. Only SECURITY DEFINER RPCs write here, so
-- a staff member cannot hand-craft a plausible-looking audit row through
-- PostgREST. An audit trail that its own subjects can write to is not one.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.audit_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations(id) on delete cascade,
  actor_id    uuid references public.profiles(id),
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  reason      text,
  created_at  timestamptz not null default now()
);

create index if not exists audit_events_org_idx on public.audit_events (org_id, created_at desc);
create index if not exists audit_events_entity_idx on public.audit_events (entity_type, entity_id);

comment on table public.audit_events is
  'Append-only history. No INSERT/UPDATE/DELETE policy or grant for any client role — written only by SECURITY DEFINER RPCs, never editable once written.';

-- ───────────────────────────────────────────────────────────────────────────
-- RLS helpers. Defined AFTER profiles, because a `language sql` body is
-- parsed at creation time and would fail on a table that doesn't exist yet.
--
-- SECURITY DEFINER to break policy recursion on profiles: a SECURITY INVOKER
-- version would have its own read of profiles policy-checked, and that policy
-- calls this function, which reads profiles… Postgres raises "infinite
-- recursion detected in policy for relation profiles".
--
-- Callers use `(select public.current_org_id())` — the parenthesised subselect
-- is hoisted to an InitPlan evaluated once per query rather than once per row.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from public.profiles where id = (select auth.uid())
$$;

comment on function public.current_org_id() is
  'The calling user''s organisation. SECURITY DEFINER to avoid RLS recursion on profiles.';

create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid())
$$;

comment on function public.current_role_name() is
  'The calling user''s role. SECURITY DEFINER for the same reason as current_org_id().';

create or replace function public.has_role(variadic p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_role_name() = any(p_roles), false)
$$;

comment on function public.has_role(variadic text[]) is
  'True when the caller holds any of the named roles. Variadic so policies read has_role(''owner'') today and has_role(''owner'',''manager'') later, unchanged.';

revoke execute on function public.current_org_id()          from public;
revoke execute on function public.current_role_name()       from public;
revoke execute on function public.has_role(variadic text[]) from public;
grant  execute on function public.current_org_id()          to authenticated;
grant  execute on function public.current_role_name()       to authenticated;
grant  execute on function public.has_role(variadic text[]) to authenticated;


-- ───────────────────────────────────────────────────────────────────────────
-- RLS
-- ───────────────────────────────────────────────────────────────────────────
alter table public.organisations enable row level security;
alter table public.profiles      enable row level security;
alter table public.audit_events  enable row level security;

drop policy if exists "organisations_select" on public.organisations;
create policy "organisations_select" on public.organisations
  for select to authenticated using (id = (select public.current_org_id()));

drop policy if exists "organisations_update" on public.organisations;
create policy "organisations_update" on public.organisations
  for update to authenticated
  using      (id = (select public.current_org_id()) and (select public.has_role('owner')))
  with check (id = (select public.current_org_id()));

-- No INSERT policy: organisations are created only by create_organisation()
-- (migration 04), which is the single self-serve path onto this table.
-- No DELETE policy anywhere: organisations and staff are deactivated, never
-- deleted, so issued documents keep their references.

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (org_id = (select public.current_org_id()));

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update to authenticated
  using      (id = (select auth.uid())
              or (org_id = (select public.current_org_id()) and (select public.has_role('owner'))))
  with check (org_id = (select public.current_org_id()));

-- No INSERT policy: the first profile is written by create_organisation(),
-- and teammates will be added by an invite RPC, never by a direct client write.

drop policy if exists "audit_events_select" on public.audit_events;
create policy "audit_events_select" on public.audit_events
  for select to authenticated using (org_id = (select public.current_org_id()));

revoke all on public.organisations from anon;
revoke all on public.profiles      from anon;
revoke all on public.audit_events  from anon;

grant select, update on public.organisations to authenticated;
grant select, update on public.profiles      to authenticated;
grant select          on public.audit_events to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop table if exists public.audit_events;
-- drop table if exists public.profiles;
-- drop table if exists public.organisations;
-- drop function if exists public.has_role(variadic text[]);
-- drop function if exists public.current_role_name();
-- drop function if exists public.current_org_id();
