-- ═══════════════════════════════════════════════════════════════════════════
-- 24 · Expenses: overhead, not tied to any one job
--
-- Direct job cost lives on activities.direct_cost_minor (see 0005) — what
-- delivering THIS trip or THIS load actually cost. Rent, salaries and
-- subscriptions do not belong to any one activity, and forcing them onto one
-- would fabricate a job cost that isn't real. Expenses is that separate,
-- simple log.
--
-- Modelled on a sibling app's expenses table, with the one real bug in its
-- history fixed from the start rather than patched in later: party_id here
-- is a composite (party_id, org_id) foreign key from day one, so an org can
-- never attach its own expense to a stranger's party — no write path can
-- forget the check, because there is no code path to remember it in. See
-- parties_id_org_uniq below.
--
-- Like parties, expenses carries no cross-cutting invariant RLS cannot
-- express — no numbering, no allocation, no frozen snapshot — so it is
-- written directly by the client rather than through an RPC, the same
-- reasoning migration 03 gives for parties.
-- ═══════════════════════════════════════════════════════════════════════════

-- A composite key target on parties, purely so a child table can pin
-- (party, org) as one FK. Redundant as a uniqueness claim on its own — id is
-- already the primary key — and that is the point: it exists to be
-- referenced.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'parties_id_org_uniq'
  ) then
    alter table public.parties
      add constraint parties_id_org_uniq unique (id, org_id);
  end if;
end $$;

create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations(id) on delete cascade,
  category     text not null
               constraint expenses_category_chk check (length(trim(category)) > 1),
  description  text,
  currency     char(3) not null,
  amount_minor bigint not null
               constraint expenses_amount_chk check (amount_minor > 0),
  incurred_on  date not null default current_date,
  party_id     uuid,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- `on delete set null (party_id)` nulls only the party column — a plain
  -- `set null` would also try to null org_id, which is not-null, and fail.
  -- Postgres 15+.
  constraint expenses_party_org_fk
    foreign key (party_id, org_id) references public.parties (id, org_id)
    on delete set null (party_id)
);

create index if not exists expenses_org_idx on public.expenses (org_id, incurred_on desc);

comment on table public.expenses is
  'Overhead not tied to a specific activity — rent, salaries, subscriptions. Direct job cost lives on activities.direct_cost_minor instead.';
comment on constraint expenses_party_org_fk on public.expenses is
  'An expense may only reference a party in its own organisation.';

drop trigger if exists expenses_updated_at on public.expenses;
create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();

alter table public.expenses enable row level security;

drop policy if exists "expenses_select" on public.expenses;
create policy "expenses_select" on public.expenses
  for select to authenticated using (org_id = (select public.current_org_id()));

drop policy if exists "expenses_insert" on public.expenses;
create policy "expenses_insert" on public.expenses
  for insert to authenticated with check (org_id = (select public.current_org_id()));

drop policy if exists "expenses_update" on public.expenses;
create policy "expenses_update" on public.expenses
  for update to authenticated
  using      (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));

revoke all on public.expenses from anon;
grant select, insert, update on public.expenses to authenticated;
-- Granted here rather than left to Supabase's defaults, which give a new
-- table only REFERENCES/TRIGGER/TRUNCATE to service_role — no DML, no
-- SELECT — which would silently break server-only tooling (seeding, support
-- scripts) the moment it touched this table.
grant select, insert, update on public.expenses to service_role;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop table if exists public.expenses;
-- alter table public.parties drop constraint if exists parties_id_org_uniq;
