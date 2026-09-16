-- ═══════════════════════════════════════════════════════════════════════════
-- 03 · Parties
--
-- A party is anyone on the other side of a transaction: a customer you invoice,
-- a supplier you owe, or a third party goods went to. Deliberately one table
-- rather than separate customers/suppliers — the same legal entity is often
-- both (a recycler buys material from a yard and sells flake back to it), and
-- splitting them means reconciling two records of one relationship.
--
-- Identity only. Contacts and addresses get their own tables when a customer
-- needs more than one of either; nothing here blocks that later.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.parties (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations(id) on delete cascade,
  name          text not null
                constraint parties_name_chk check (length(trim(name)) > 1),

  -- Jurisdiction, for tax. country_code defaults from the organisation at
  -- insert time in the API layer; region_code is what split_rate compares.
  country_code  char(2)
                constraint parties_country_chk check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  region_code   text,

  -- Statutory identifier — GSTIN, VAT number, TRN, EIN. Shape is validated
  -- per country in lib/regions/, never by a constraint here, because the
  -- schema must not know which countries exist.
  tax_id        text,
  tax_id_kind   text,

  -- Commercial terms.
  payment_terms_days integer not null default 30
                constraint parties_terms_chk check (payment_terms_days between 0 and 365),
  credit_limit_minor bigint
                constraint parties_credit_limit_chk check (credit_limit_minor is null or credit_limit_minor >= 0),

  email         text,
  phone         text,
  address       text,
  notes         text,

  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists parties_org_name_idx on public.parties (org_id, name);

-- Trigram index for duplicate detection: before creating a party, the app
-- looks for an existing one with a similar name in the same org.
create index if not exists parties_name_trgm_idx
  on public.parties using gin (name extensions.gin_trgm_ops);

-- One tax identifier per org. Partial so the many parties without one don't
-- collide with each other on NULL.
create unique index if not exists parties_org_tax_id_uniq
  on public.parties (org_id, tax_id) where tax_id is not null;

comment on table public.parties is
  'Anyone on the other side of a transaction — customer, supplier, or a third party goods went to. One table, because the same entity is often more than one of those.';
comment on column public.parties.credit_limit_minor is
  'Minor units of the organisation''s base currency. See CONVENTIONS.md section 9.';

drop trigger if exists parties_updated_at on public.parties;
create trigger parties_updated_at before update on public.parties
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- RLS. Parties carry no cross-cutting invariant that RLS cannot express, so
-- unlike the financial tables they are written directly by the client rather
-- than through an RPC.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.parties enable row level security;

drop policy if exists "parties_select" on public.parties;
create policy "parties_select" on public.parties
  for select to authenticated using (org_id = (select public.current_org_id()));

drop policy if exists "parties_insert" on public.parties;
create policy "parties_insert" on public.parties
  for insert to authenticated with check (org_id = (select public.current_org_id()));

drop policy if exists "parties_update" on public.parties;
create policy "parties_update" on public.parties
  for update to authenticated
  using      (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));

revoke all on public.parties from anon;
grant select, insert, update on public.parties to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop table if exists public.parties;
