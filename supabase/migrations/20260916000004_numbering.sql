-- ═══════════════════════════════════════════════════════════════════════════
-- 04 · Document numbering, and organisation creation
--
-- A counter table, not a Postgres SEQUENCE: sequences are non-transactional
-- and do not roll back, so a failed insert would permanently burn a number.
-- An invoice series with a hole in it is a compliance problem, not a cosmetic
-- one. A counter row updated inside the caller's transaction rolls back with
-- it and is therefore genuinely gapless.
--
-- Two changes from LedgerFlow, both deliberate:
--
--   1. The prefix comes from a document_series TABLE, not from columns on
--      organisations. LedgerFlow resolved it with
--      `case p_doc_type when 'INVOICE' then invoice_prefix ...`, which needs a
--      new column and a new branch for every document kind, forever.
--
--   2. next_doc_number() takes the DOCUMENT's date, and derives the period key
--      from it. LedgerFlow passed current_date, so an invoice entered in April
--      for work done in March was numbered into the wrong financial year —
--      out of sequence, and unfixable once issued.
--
-- next_doc_number() also derives the organisation from current_org_id() rather
-- than taking it as a parameter. LedgerFlow's took one, never validated it,
-- and was granted to authenticated — so any signed-in user could advance a
-- stranger's counter and punch a permanent gap in their book.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- document_series: per organisation, per document kind — the prefix, whether
-- we number it at all, and how often the counter resets.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.document_series (
  org_id   uuid not null references public.organisations(id) on delete cascade,
  doc_kind text not null
           constraint document_series_kind_chk
           check (doc_kind in ('invoice', 'bill', 'credit_note', 'debit_note')),
  prefix   text not null
           constraint document_series_prefix_chk check (prefix ~ '^[A-Z]{2,6}$'),

  -- False for supplier documents: you do not number a bill your supplier sent
  -- you. next_doc_number() refuses, and the document carries their number in
  -- party_doc_no instead.
  is_self_numbered boolean not null default true,

  -- Not every country resets by financial year.
  reset_cadence text not null default 'fiscal_year'
           constraint document_series_reset_chk
           check (reset_cadence in ('never', 'fiscal_year', 'calendar_year', 'monthly')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, doc_kind)
);

comment on table public.document_series is
  'Per-organisation numbering rules for each document kind: prefix, whether we number it at all, and the counter reset cadence.';

drop trigger if exists document_series_updated_at on public.document_series;
create trigger document_series_updated_at before update on public.document_series
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- document_sequences: the counters themselves.
--
-- Deny-all: RLS on, zero policies, grants revoked from BOTH client roles. A
-- client that could increment a counter directly could burn numbers or forge
-- them. Only SECURITY DEFINER functions may touch this.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.document_sequences (
  org_id     uuid not null references public.organisations(id) on delete cascade,
  doc_kind   text not null
             constraint document_sequences_kind_chk
             check (doc_kind in ('invoice', 'bill', 'credit_note', 'debit_note')),
  -- '2627' (financial year), '2026' (calendar year), '202609' (monthly), or
  -- 'ALL' when the series never resets.
  period_key text not null
             constraint document_sequences_period_chk check (period_key ~ '^([0-9]{4}|[0-9]{6}|ALL)$'),
  last_value bigint not null default 0
             constraint document_sequences_value_chk check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (org_id, doc_kind, period_key)
);

comment on table public.document_sequences is
  'Gapless counters. Deny-all by design: RLS enabled with zero policies and no grant to any client role — only SECURITY DEFINER functions increment these.';

alter table public.document_sequences enable row level security;
revoke all on public.document_sequences from anon, authenticated;

alter table public.document_series enable row level security;

drop policy if exists "document_series_select" on public.document_series;
create policy "document_series_select" on public.document_series
  for select to authenticated using (org_id = (select public.current_org_id()));

drop policy if exists "document_series_update" on public.document_series;
create policy "document_series_update" on public.document_series
  for update to authenticated
  using      (org_id = (select public.current_org_id()) and (select public.has_role('owner')))
  with check (org_id = (select public.current_org_id()));

revoke all on public.document_series from anon;
grant select, update on public.document_series to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- period_key_for: which counter a document dated p_date belongs to.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.period_key_for(
  p_date          date,
  p_reset_cadence text,
  p_fy_start_month integer
)
returns text
language sql
immutable
parallel safe
as $$
  select case p_reset_cadence
    when 'never'         then 'ALL'
    when 'calendar_year' then to_char(p_date, 'YYYY')
    when 'monthly'       then to_char(p_date, 'YYYYMM')
    else public.fiscal_year_code(p_date, p_fy_start_month)
  end
$$;

comment on function public.period_key_for(date, text, integer) is
  'The document_sequences.period_key a document dated p_date belongs to, under the given reset cadence.';

-- ───────────────────────────────────────────────────────────────────────────
-- next_doc_number: allocate the next number for a document kind, on the
-- caller's own organisation, for the period the DOCUMENT DATE falls in.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.next_doc_number(
  p_doc_kind text,
  p_doc_date date
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org        uuid := (select public.current_org_id());
  v_prefix     text;
  v_cadence    text;
  v_self       boolean;
  v_fy_start   integer;
  v_period_key text;
  v_seq        bigint;
begin
  if v_org is null then
    raise exception 'next_doc_number: no organisation for this account' using errcode = '28000';
  end if;
  if p_doc_kind not in ('invoice', 'bill', 'credit_note', 'debit_note') then
    raise exception 'next_doc_number: unknown doc_kind %', p_doc_kind using errcode = '22023';
  end if;

  select s.prefix, s.reset_cadence, s.is_self_numbered, o.fiscal_year_start_month
    into v_prefix, v_cadence, v_self, v_fy_start
    from public.document_series s
    join public.organisations o on o.id = s.org_id
   where s.org_id = v_org and s.doc_kind = p_doc_kind;

  if v_prefix is null then
    raise exception 'next_doc_number: no % series configured for this organisation', p_doc_kind
      using errcode = 'P0002';
  end if;

  -- A supplier's document already has their number. Refusing here rather than
  -- silently issuing ours keeps the two from ever being confused.
  if not v_self then
    raise exception 'next_doc_number: the % series is not self-numbered — record the counterparty''s number instead', p_doc_kind
      using errcode = '22023';
  end if;

  v_period_key := public.period_key_for(p_doc_date, v_cadence, v_fy_start);

  -- One statement, so allocation is atomic: no SELECT-then-UPDATE race. The
  -- DO UPDATE takes a row lock held until the caller's transaction ends, so
  -- concurrent callers serialise and a rollback returns the number to the pool.
  insert into public.document_sequences as ds (org_id, doc_kind, period_key, last_value)
  values (v_org, p_doc_kind, v_period_key, 1)
  on conflict (org_id, doc_kind, period_key)
  do update set last_value = ds.last_value + 1,
                updated_at = now()
  returning ds.last_value into v_seq;

  -- Checked after allocation on purpose: the raise rolls the increment back.
  if v_seq > 999999 then
    raise exception 'next_doc_number: sequence exhausted for % % %', v_org, p_doc_kind, v_period_key
      using errcode = '22003';
  end if;

  return v_prefix || '-' || v_period_key || '-' || lpad(v_seq::text, 6, '0');
end;
$$;

comment on function public.next_doc_number(text, date) is
  'Allocates the next gapless number for a document kind on the caller''s organisation, keyed to the period the DOCUMENT DATE falls in. Transactional: rolls back with the caller, so no number is ever burned.';

revoke execute on function public.next_doc_number(text, date) from public;
-- Deliberately NOT granted to authenticated: only SECURITY DEFINER callers
-- (issue_document) reach this, and they run as the definer so the chain works.

-- ───────────────────────────────────────────────────────────────────────────
-- create_organisation: the only self-serve path onto organisations/profiles.
--
-- Cannot use the usual verifyAuth() guard in the API layer, because that
-- requires a profiles row — which is exactly what this creates. The guard is
-- here instead: a caller who already belongs to an organisation is refused.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.create_organisation(
  p_legal_name    text,
  p_country_code  char(2),
  p_base_currency char(3),
  p_region_code   text default null,
  p_locale        text default 'en',
  p_timezone      text default 'UTC',
  p_fiscal_year_start_month integer default 1,
  p_tax_regime    text default 'none',
  p_default_tax_rate_pct numeric default 0,
  p_tax_id        text default null,
  p_tax_id_kind   text default null,
  p_address       text default null,
  p_full_name     text default null,
  p_invoice_prefix text default 'INV',
  p_credit_note_prefix text default 'CN'
)
returns table (org_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  if v_uid is null then
    raise exception 'create_organisation: no authenticated user' using errcode = '28000';
  end if;

  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'create_organisation: this account already belongs to an organisation'
      using errcode = '23505';
  end if;

  insert into public.organisations (
    legal_name, country_code, region_code, base_currency, locale, timezone,
    fiscal_year_start_month, tax_regime, default_tax_rate_pct,
    tax_id, tax_id_kind, address
  ) values (
    p_legal_name, upper(p_country_code), nullif(p_region_code, ''), upper(p_base_currency),
    p_locale, p_timezone, p_fiscal_year_start_month, p_tax_regime, p_default_tax_rate_pct,
    nullif(p_tax_id, ''), nullif(p_tax_id_kind, ''), nullif(p_address, '')
  )
  returning id into v_org;

  insert into public.profiles (id, org_id, full_name, role)
  values (
    v_uid, v_org,
    coalesce(nullif(p_full_name, ''),
             (select raw_user_meta_data ->> 'full_name' from auth.users where id = v_uid)),
    'owner'
  );

  -- Seed the numbering rules. Receivable kinds are ours to number; payable
  -- kinds are not, so they are created non-self-numbered from the start.
  insert into public.document_series (org_id, doc_kind, prefix, is_self_numbered) values
    (v_org, 'invoice',     upper(p_invoice_prefix),     true),
    (v_org, 'credit_note', upper(p_credit_note_prefix), true),
    (v_org, 'bill',        'BILL',                      false),
    (v_org, 'debit_note',  'DN',                        false);

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'organisation.created', 'organisation', v_org,
          jsonb_build_object('legal_name', p_legal_name, 'country_code', upper(p_country_code),
                             'base_currency', upper(p_base_currency), 'tax_regime', p_tax_regime));

  return query select v_org;
end;
$$;

comment on function public.create_organisation(
  text, char, char, text, text, text, integer, text, numeric, text, text, text, text, text, text
) is 'Creates an organisation, the caller as its owner, and its document series, in one transaction. The only self-serve path onto organisations/profiles.';

revoke execute on function public.create_organisation(
  text, char, char, text, text, text, integer, text, numeric, text, text, text, text, text, text
) from public;
grant execute on function public.create_organisation(
  text, char, char, text, text, text, integer, text, numeric, text, text, text, text, text, text
) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.create_organisation(text, char, char, text, text, text, integer, text, numeric, text, text, text, text, text, text);
-- drop function if exists public.next_doc_number(text, date);
-- drop function if exists public.period_key_for(date, text, integer);
-- drop table if exists public.document_sequences;
-- drop table if exists public.document_series;
