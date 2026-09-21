-- ═══════════════════════════════════════════════════════════════════════════
-- 26 · The logistics vertical's own ledger
--
-- First fork of the per-vertical split: freight gets its own activities,
-- documents, payments and allocations tables, its own numbering sequences,
-- and its own RLS — a real second ledger, not a view over the shared one.
-- A bug in this file cannot corrupt scrap/hospitality/wholesale/generic data,
-- because it is a different table.
--
-- ADDITIVE ONLY. Nothing here touches activities/documents/payments/
-- allocations or their RPCs — every existing e2e test keeps passing against
-- the unchanged shared engine, for every org not moved onto this one.
--
-- WHAT STAYS SHARED, ON PURPOSE: current_org_id(), has_role(), set_updated_at(),
-- fiscal_year_code(), the Supabase auth/session model, organisations/profiles/
-- parties. These are tenancy and identity primitives with no billing logic in
-- them — forking byte-identical SQL under a new name would not isolate a
-- logistics bug from anything, it would just be the same code twice. What
-- forks here is the part that actually differs: the ledger itself.
--
-- WHAT THIS MIGRATION COVERS: the core money flow — record work, issue an
-- invoice or a bill, take or send a payment, allocate it. Credit/debit
-- notes, cancellation and PDF rendering for this vertical are follow-up
-- work, called out at the bottom rather than rushed here.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- Which ledger an organisation is on. 'shared' (the default) is every
-- existing org, untouched. 'logistics' orgs are served exclusively by the
-- tables below — the application layer decides which route tree and API
-- routes an org reaches based on this flag, never by inspecting both ledgers.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.organisations
  add column if not exists vertical text not null default 'shared'
  constraint organisations_vertical_chk check (vertical in ('shared', 'logistics'));

comment on column public.organisations.vertical is
  'Which ledger this organisation is served by. shared = activities/documents/payments (multi-industry engine). logistics = logistics_activities/logistics_documents/logistics_payments (freight-only fork).';

-- ───────────────────────────────────────────────────────────────────────────
-- logistics_activities — freight recorded directly, no generic field system.
--
-- A forked vertical does not need activity_types/activity_fields: it serves
-- one trade, so its own fields can be real, typed columns instead of a
-- free-shaped configuration blob validated against configurable rows. Trip fields
-- (origin/destination/vehicle/load_type) and the payable vendor-charge case
-- both live here, distinguished by `direction` exactly as the shared engine
-- distinguishes them.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.logistics_activities (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organisations(id) on delete cascade,
  party_id          uuid not null,
  bill_to_party_id  uuid,
  direction         text not null
                    constraint logistics_activities_direction_chk check (direction in ('receivable', 'payable')),
  occurred_on       date not null,
  currency          char(3) not null,
  amount_minor      bigint not null
                    constraint logistics_activities_amount_chk check (amount_minor >= 0),
  direct_cost_minor bigint
                    constraint logistics_activities_cost_chk check (direct_cost_minor is null or direct_cost_minor >= 0),

  -- Trip fields — receivable side.
  origin            text,
  destination       text,
  vehicle_no        text,
  load_type         text
                    constraint logistics_activities_load_type_chk
                    check (load_type is null or load_type in ('Full truckload', 'Part load', 'Express')),

  -- Vendor-charge fields — payable side.
  vendor_ref        text,

  reference         text,
  notes             text,
  attachment_path   text,
  status            text not null default 'completed'
                    constraint logistics_activities_status_chk
                    check (status in ('pending', 'completed', 'invoiced', 'cancelled')),

  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint logistics_activities_party_org_fk
    foreign key (party_id, org_id) references public.parties (id, org_id),
  constraint logistics_activities_bill_to_org_fk
    foreign key (bill_to_party_id, org_id) references public.parties (id, org_id)
);

create index if not exists logistics_activities_org_idx on public.logistics_activities (org_id, occurred_on desc);
create index if not exists logistics_activities_party_idx on public.logistics_activities (org_id, coalesce(bill_to_party_id, party_id));

comment on table public.logistics_activities is
  'Freight work: trips (receivable) and vendor charges (payable), typed columns rather than a configurable free-shaped blob — the logistics ledger serves one trade.';

drop trigger if exists logistics_activities_updated_at on public.logistics_activities;
create trigger logistics_activities_updated_at before update on public.logistics_activities
  for each row execute function public.set_updated_at();

alter table public.logistics_activities enable row level security;

drop policy if exists "logistics_activities_select" on public.logistics_activities;
create policy "logistics_activities_select" on public.logistics_activities
  for select to authenticated using (org_id = (select public.current_org_id()));

revoke all on public.logistics_activities from anon;
grant select on public.logistics_activities to authenticated;
grant select, insert, update on public.logistics_activities to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Numbering — this vertical's own sequence space, isolated from the shared
-- engine's document_series/document_sequences.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.logistics_document_series (
  org_id            uuid not null references public.organisations(id) on delete cascade,
  doc_kind          text not null
                    constraint logistics_document_series_kind_chk
                    check (doc_kind in ('invoice', 'bill')),
  prefix            text not null
                    constraint logistics_document_series_prefix_chk check (prefix ~ '^[A-Z]{2,6}$'),
  is_self_numbered  boolean not null default true,
  updated_at        timestamptz not null default now(),
  primary key (org_id, doc_kind)
);

drop trigger if exists logistics_document_series_updated_at on public.logistics_document_series;
create trigger logistics_document_series_updated_at before update on public.logistics_document_series
  for each row execute function public.set_updated_at();

create table if not exists public.logistics_document_sequences (
  org_id      uuid not null references public.organisations(id) on delete cascade,
  doc_kind    text not null,
  period_key  text not null,
  last_value  integer not null default 0,
  primary key (org_id, doc_kind, period_key)
);

alter table public.logistics_document_series enable row level security;
drop policy if exists "logistics_document_series_select" on public.logistics_document_series;
create policy "logistics_document_series_select" on public.logistics_document_series
  for select to authenticated using (org_id = (select public.current_org_id()));
revoke all on public.logistics_document_series from anon;
grant select on public.logistics_document_series to authenticated;
grant select, insert, update on public.logistics_document_series to service_role;

alter table public.logistics_document_sequences enable row level security;
revoke all on public.logistics_document_sequences from anon, authenticated;
grant select, insert, update on public.logistics_document_sequences to service_role;

create or replace function public.next_logistics_doc_number(p_doc_kind text, p_doc_date date)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org       uuid := (select public.current_org_id());
  v_prefix    text;
  v_self      boolean;
  v_period    text;
  v_seq       integer;
  v_fy_start  integer;
begin
  if v_org is null then
    raise exception 'next_logistics_doc_number: no organisation for this account' using errcode = '28000';
  end if;
  if p_doc_kind not in ('invoice', 'bill') then
    raise exception 'next_logistics_doc_number: unknown doc_kind %', p_doc_kind using errcode = '22023';
  end if;

  select prefix, is_self_numbered into v_prefix, v_self
    from public.logistics_document_series
   where org_id = v_org and doc_kind = p_doc_kind;

  if v_prefix is null then
    raise exception 'next_logistics_doc_number: no % series configured for this organisation', p_doc_kind
      using errcode = 'P0002';
  end if;
  if not v_self then
    raise exception 'next_logistics_doc_number: the % series is not self-numbered — record the counterparty''s number instead', p_doc_kind
      using errcode = '22023';
  end if;

  select fiscal_year_start_month into v_fy_start from public.organisations where id = v_org;
  v_period := public.fiscal_year_code(p_doc_date, v_fy_start);

  insert into public.logistics_document_sequences as ds (org_id, doc_kind, period_key, last_value)
  values (v_org, p_doc_kind, v_period, 1)
  on conflict (org_id, doc_kind, period_key)
  do update set last_value = ds.last_value + 1
  returning last_value into v_seq;

  return v_prefix || '/' || v_period || '/' || lpad(v_seq::text, 4, '0');
end;
$$;

revoke execute on function public.next_logistics_doc_number(text, date) from public;
grant  execute on function public.next_logistics_doc_number(text, date) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- logistics_documents / lines / taxes — same shape as the shared engine's
-- documents/document_lines/document_taxes, own table.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.logistics_documents (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organisations(id) on delete cascade,
  direction         text not null check (direction in ('receivable', 'payable')),
  doc_kind          text not null check (doc_kind in ('invoice', 'bill')),
  doc_no            text,
  party_doc_no      text,
  doc_date          date not null,
  due_date          date,
  counterparty_id   uuid not null,
  ship_to_party_id  uuid,
  status            text not null default 'issued' check (status in ('issued', 'cancelled')),
  currency          char(3) not null,
  taxable_value_minor bigint not null check (taxable_value_minor >= 0),
  tax_treatment     text not null default 'forward' check (tax_treatment in ('forward', 'reverse_charge', 'exempt')),
  total_minor       bigint not null check (total_minor >= 0),
  notes             text,
  issued_snapshot   jsonb,
  pdf_path          text,
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),

  constraint logistics_documents_counterparty_org_fk
    foreign key (counterparty_id, org_id) references public.parties (id, org_id),
  constraint logistics_documents_shipto_org_fk
    foreign key (ship_to_party_id, org_id) references public.parties (id, org_id),
  constraint logistics_documents_kind_direction_chk
    check ((doc_kind = 'invoice' and direction = 'receivable') or (doc_kind = 'bill' and direction = 'payable'))
);

create unique index if not exists logistics_documents_org_doc_no_uniq
  on public.logistics_documents (org_id, doc_kind, doc_no) where doc_no is not null;
create unique index if not exists logistics_documents_party_no_uniq
  on public.logistics_documents (org_id, counterparty_id, party_doc_no) where party_doc_no is not null;
create index if not exists logistics_documents_org_idx on public.logistics_documents (org_id, doc_date desc);

alter table public.logistics_documents enable row level security;
drop policy if exists "logistics_documents_select" on public.logistics_documents;
create policy "logistics_documents_select" on public.logistics_documents
  for select to authenticated using (org_id = (select public.current_org_id()));
revoke all on public.logistics_documents from anon;
grant select on public.logistics_documents to authenticated;
grant select, insert, update on public.logistics_documents to service_role;

create table if not exists public.logistics_document_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations(id) on delete cascade,
  document_id   uuid not null references public.logistics_documents(id) on delete cascade,
  activity_id   uuid references public.logistics_activities(id) on delete restrict,
  description   text not null,
  amount_minor  bigint not null check (amount_minor >= 0),
  sort_order    integer not null default 0
);

create unique index if not exists logistics_document_lines_activity_uniq
  on public.logistics_document_lines (activity_id) where activity_id is not null;

alter table public.logistics_document_lines enable row level security;
drop policy if exists "logistics_document_lines_select" on public.logistics_document_lines;
create policy "logistics_document_lines_select" on public.logistics_document_lines
  for select to authenticated using (org_id = (select public.current_org_id()));
revoke all on public.logistics_document_lines from anon;
grant select on public.logistics_document_lines to authenticated;
grant select, insert on public.logistics_document_lines to service_role;

create table if not exists public.logistics_document_taxes (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organisations(id) on delete cascade,
  document_id       uuid not null references public.logistics_documents(id) on delete cascade,
  component_code    text not null,
  component_label   text not null,
  rate_pct          numeric(5,2) not null,
  amount_minor      bigint not null check (amount_minor >= 0)
);

alter table public.logistics_document_taxes enable row level security;
drop policy if exists "logistics_document_taxes_select" on public.logistics_document_taxes;
create policy "logistics_document_taxes_select" on public.logistics_document_taxes
  for select to authenticated using (org_id = (select public.current_org_id()));
revoke all on public.logistics_document_taxes from anon;
grant select on public.logistics_document_taxes to authenticated;
grant select, insert on public.logistics_document_taxes to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- logistics_payments / logistics_allocations
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.logistics_payments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations(id) on delete cascade,
  direction     text not null check (direction in ('in', 'out')),
  party_id      uuid not null,
  currency      char(3) not null,
  amount_minor  bigint not null check (amount_minor > 0),
  paid_on       date not null,
  method        text not null check (method in ('cash', 'bank', 'card', 'online', 'cheque')),
  reference_no  text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),

  constraint logistics_payments_party_org_fk
    foreign key (party_id, org_id) references public.parties (id, org_id)
);

create index if not exists logistics_payments_org_idx on public.logistics_payments (org_id, paid_on desc);

alter table public.logistics_payments enable row level security;
drop policy if exists "logistics_payments_select" on public.logistics_payments;
create policy "logistics_payments_select" on public.logistics_payments
  for select to authenticated using (org_id = (select public.current_org_id()));
revoke all on public.logistics_payments from anon;
grant select on public.logistics_payments to authenticated;
grant select, insert on public.logistics_payments to service_role;

create table if not exists public.logistics_allocations (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organisations(id) on delete cascade,
  target_document_id    uuid not null references public.logistics_documents(id) on delete restrict,
  payment_id            uuid references public.logistics_payments(id) on delete restrict,
  amount_minor          bigint not null check (amount_minor > 0),
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),

  constraint logistics_allocations_payment_chk check (payment_id is not null)
);

alter table public.logistics_allocations enable row level security;
drop policy if exists "logistics_allocations_select" on public.logistics_allocations;
create policy "logistics_allocations_select" on public.logistics_allocations
  for select to authenticated using (org_id = (select public.current_org_id()));
revoke all on public.logistics_allocations from anon;
grant select on public.logistics_allocations to authenticated;
grant select, insert on public.logistics_allocations to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Balance views — same shape as document_balances/payment_balances.
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.logistics_document_balances
with (security_invoker = true) as
select
  d.id as document_id, d.org_id, d.direction, d.doc_kind, d.counterparty_id,
  d.doc_no, d.party_doc_no, d.doc_date, d.due_date, d.currency, d.total_minor,
  coalesce(p.settled_minor, 0) as settled_minor,
  d.total_minor - coalesce(p.settled_minor, 0) as balance_due_minor
from public.logistics_documents d
left join (
  select target_document_id, sum(amount_minor) as settled_minor
    from public.logistics_allocations group by target_document_id
) p on p.target_document_id = d.id
where d.status = 'issued';

grant select on public.logistics_document_balances to authenticated;
revoke all on public.logistics_document_balances from anon;

create or replace view public.logistics_payment_balances
with (security_invoker = true) as
select
  p.id as payment_id, p.org_id, p.direction, p.party_id, p.currency, p.paid_on, p.amount_minor,
  coalesce(a.applied_minor, 0) as applied_minor,
  p.amount_minor - coalesce(a.applied_minor, 0) as unapplied_minor
from public.logistics_payments p
left join (
  select payment_id, sum(amount_minor) as applied_minor
    from public.logistics_allocations group by payment_id
) a on a.payment_id = p.id;

grant select on public.logistics_payment_balances to authenticated;
revoke all on public.logistics_payment_balances from anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPCs — record, issue, pay, allocate. Mirrors the shared engine's own
-- validation and locking exactly (row locks before balance checks, amounts
-- computed server-side, owner-only for money-moving actions) — the same
-- rules, a separate table.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.record_logistics_activity(
  p_direction         text,
  p_party_id          uuid,
  p_occurred_on       date,
  p_amount_minor      bigint,
  p_bill_to_party_id  uuid default null,
  p_origin            text default null,
  p_destination       text default null,
  p_vehicle_no        text default null,
  p_load_type         text default null,
  p_vendor_ref        text default null,
  p_reference         text default null,
  p_notes             text default null,
  p_direct_cost_minor bigint default null
)
returns table (activity_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_org is null then
    raise exception 'record_logistics_activity: no organisation for this account' using errcode = '28000';
  end if;
  if p_direction not in ('receivable', 'payable') then
    raise exception 'record_logistics_activity: direction must be receivable or payable' using errcode = '22023';
  end if;
  if not exists (select 1 from public.parties where id = p_party_id and org_id = v_org) then
    raise exception 'record_logistics_activity: party not found in your organisation' using errcode = 'P0002';
  end if;
  if p_bill_to_party_id is not null
     and not exists (select 1 from public.parties where id = p_bill_to_party_id and org_id = v_org) then
    raise exception 'record_logistics_activity: bill-to party not found in your organisation' using errcode = 'P0002';
  end if;
  if p_amount_minor < 0 then
    raise exception 'record_logistics_activity: amount cannot be negative' using errcode = '22003';
  end if;

  insert into public.logistics_activities (
    org_id, party_id, bill_to_party_id, direction, occurred_on, currency, amount_minor,
    direct_cost_minor, origin, destination, vehicle_no, load_type, vendor_ref,
    reference, notes, status, created_by
  )
  select v_org, p_party_id, p_bill_to_party_id, p_direction, p_occurred_on, o.base_currency, p_amount_minor,
         p_direct_cost_minor, p_origin, p_destination, p_vehicle_no, p_load_type, p_vendor_ref,
         nullif(p_reference, ''), nullif(p_notes, ''), 'completed', v_uid
    from public.organisations o where o.id = v_org
  returning id into v_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'logistics_activity.recorded', 'logistics_activity', v_id,
          jsonb_build_object('direction', p_direction, 'amount_minor', p_amount_minor));

  return query select v_id;
end;
$$;

revoke execute on function public.record_logistics_activity(text, uuid, date, bigint, uuid, text, text, text, text, text, text, text, bigint) from public;
grant  execute on function public.record_logistics_activity(text, uuid, date, bigint, uuid, text, text, text, text, text, text, text, bigint) to authenticated;

create or replace function public.issue_logistics_document(
  p_doc_kind            text,
  p_counterparty_id     uuid,
  p_doc_date            date,
  p_taxable_value_minor bigint,
  p_total_minor         bigint,
  p_taxes               jsonb default '[]'::jsonb,
  p_activity_ids        uuid[] default '{}',
  p_tax_treatment       text default 'forward',
  p_due_date            date default null,
  p_party_doc_no        text default null,
  p_notes               text default null
)
returns table (document_id uuid, doc_no text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org       uuid := (select public.current_org_id());
  v_uid       uuid := auth.uid();
  v_direction text;
  v_self      boolean;
  v_currency  char(3);
  v_doc_no    text;
  v_doc_id    uuid;
  v_line      jsonb;
  v_sort      integer := 0;
  v_tax       jsonb;
  v_activity  uuid;
  v_count     integer;
begin
  if v_org is null then
    raise exception 'issue_logistics_document: no organisation for this account' using errcode = '28000';
  end if;
  if not (select public.has_role('owner')) then
    raise exception 'issue_logistics_document: requires the owner role' using errcode = '42501';
  end if;
  if p_doc_kind not in ('invoice', 'bill') then
    raise exception 'issue_logistics_document: doc_kind must be invoice or bill' using errcode = '22023';
  end if;

  v_direction := case p_doc_kind when 'invoice' then 'receivable' else 'payable' end;

  if not exists (select 1 from public.parties where id = p_counterparty_id and org_id = v_org) then
    raise exception 'issue_logistics_document: counterparty not found in your organisation' using errcode = 'P0002';
  end if;
  if p_total_minor < 0 or p_taxable_value_minor < 0 then
    raise exception 'issue_logistics_document: amounts cannot be negative' using errcode = '22003';
  end if;

  select base_currency into v_currency from public.organisations where id = v_org;
  select is_self_numbered into v_self
    from public.logistics_document_series where org_id = v_org and doc_kind = p_doc_kind;
  if v_self is null then
    raise exception 'issue_logistics_document: no % series configured for this organisation', p_doc_kind
      using errcode = 'P0002';
  end if;

  if v_self then
    v_doc_no := public.next_logistics_doc_number(p_doc_kind, p_doc_date);
  elsif nullif(p_party_doc_no, '') is null then
    raise exception 'issue_logistics_document: the % series is not self-numbered, so the counterparty''s document number is required', p_doc_kind
      using errcode = '22004';
  end if;

  if array_length(p_activity_ids, 1) > 0 then
    select count(*) into v_count
      from (
        select id from public.logistics_activities
         where id = any(p_activity_ids) and org_id = v_org and direction = v_direction and status = 'completed'
         for update
      ) locked;
    if v_count <> array_length(p_activity_ids, 1) then
      raise exception 'issue_logistics_document: one or more activities are not billable' using errcode = '23514';
    end if;
    if exists (select 1 from public.logistics_document_lines where activity_id = any(p_activity_ids)) then
      raise exception 'issue_logistics_document: one or more activities have already been billed' using errcode = '23505';
    end if;
  end if;

  insert into public.logistics_documents (
    org_id, direction, doc_kind, doc_no, party_doc_no, doc_date, due_date,
    counterparty_id, status, currency, taxable_value_minor, tax_treatment, total_minor, notes, created_by
  ) values (
    v_org, v_direction, p_doc_kind, v_doc_no, nullif(p_party_doc_no, ''), p_doc_date, p_due_date,
    p_counterparty_id, 'issued', v_currency, p_taxable_value_minor, p_tax_treatment, p_total_minor,
    nullif(p_notes, ''), v_uid
  )
  returning id into v_doc_id;

  if array_length(p_activity_ids, 1) > 0 then
    foreach v_activity in array p_activity_ids loop
      insert into public.logistics_document_lines (org_id, document_id, activity_id, description, amount_minor, sort_order)
      select v_org, v_doc_id, a.id,
             coalesce(a.origin || ' → ' || a.destination, a.vendor_ref, 'Item'),
             a.amount_minor, v_sort
        from public.logistics_activities a where a.id = v_activity;
      v_sort := v_sort + 1;
    end loop;
    update public.logistics_activities set status = 'invoiced' where id = any(p_activity_ids);
  end if;

  for v_tax in select * from jsonb_array_elements(coalesce(p_taxes, '[]'::jsonb)) loop
    insert into public.logistics_document_taxes (org_id, document_id, component_code, component_label, rate_pct, amount_minor)
    values (
      v_org, v_doc_id,
      v_tax ->> 'component_code', v_tax ->> 'component_label',
      (v_tax ->> 'rate_pct')::numeric, (v_tax ->> 'amount_minor')::bigint
    );
  end loop;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'logistics_document.issued', 'logistics_document', v_doc_id,
          jsonb_build_object('doc_kind', p_doc_kind, 'doc_no', v_doc_no, 'total_minor', p_total_minor));

  return query select v_doc_id, v_doc_no;
end;
$$;

revoke execute on function public.issue_logistics_document(text, uuid, date, bigint, bigint, jsonb, uuid[], text, date, text, text) from public;
grant  execute on function public.issue_logistics_document(text, uuid, date, bigint, bigint, jsonb, uuid[], text, date, text, text) to authenticated;

create or replace function public.record_logistics_payment(
  p_direction     text,
  p_party_id      uuid,
  p_amount_minor  bigint,
  p_paid_on       date,
  p_method        text,
  p_allocations   jsonb default '[]'::jsonb,
  p_reference_no  text default null
)
returns table (payment_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org      uuid := (select public.current_org_id());
  v_uid      uuid := auth.uid();
  v_currency char(3);
  v_id       uuid;
  v_alloc    jsonb;
begin
  if v_org is null then
    raise exception 'record_logistics_payment: no organisation for this account' using errcode = '28000';
  end if;
  if not (select public.has_role('owner')) then
    raise exception 'record_logistics_payment: requires the owner role' using errcode = '42501';
  end if;
  if p_direction not in ('in', 'out') then
    raise exception 'record_logistics_payment: direction must be in or out' using errcode = '22023';
  end if;
  if p_amount_minor <= 0 then
    raise exception 'record_logistics_payment: amount must be positive' using errcode = '22003';
  end if;
  if not exists (select 1 from public.parties where id = p_party_id and org_id = v_org) then
    raise exception 'record_logistics_payment: party not found in your organisation' using errcode = 'P0002';
  end if;

  select base_currency into v_currency from public.organisations where id = v_org;

  insert into public.logistics_payments (org_id, direction, party_id, currency, amount_minor, paid_on, method, reference_no, created_by)
  values (v_org, p_direction, p_party_id, v_currency, p_amount_minor, p_paid_on, p_method, nullif(p_reference_no, ''), v_uid)
  returning id into v_id;

  for v_alloc in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    perform public.allocate_logistics(
      (v_alloc ->> 'document_id')::uuid,
      (v_alloc ->> 'amount_minor')::bigint,
      v_id
    );
  end loop;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'logistics_payment.recorded', 'logistics_payment', v_id,
          jsonb_build_object('direction', p_direction, 'amount_minor', p_amount_minor));

  return query select v_id;
end;
$$;

revoke execute on function public.record_logistics_payment(text, uuid, bigint, date, text, jsonb, text) from public;
grant  execute on function public.record_logistics_payment(text, uuid, bigint, date, text, jsonb, text) to authenticated;

create or replace function public.allocate_logistics(
  p_target_document_id uuid,
  p_amount_minor       bigint,
  p_payment_id         uuid
)
returns table (allocation_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org       uuid := (select public.current_org_id());
  v_uid       uuid := auth.uid();
  v_target    public.logistics_documents;
  v_balance   bigint;
  v_available bigint;
  v_p_dir     text;
  v_id        uuid;
begin
  if v_org is null then
    raise exception 'allocate_logistics: no organisation for this account' using errcode = '28000';
  end if;
  if p_amount_minor <= 0 then
    raise exception 'allocate_logistics: amount must be positive' using errcode = '22003';
  end if;

  select * into v_target from public.logistics_documents
   where id = p_target_document_id and org_id = v_org and status = 'issued'
   for update;
  if v_target.id is null then
    raise exception 'allocate_logistics: target document not found or not issued' using errcode = 'P0002';
  end if;

  select balance_due_minor into v_balance
    from public.logistics_document_balances where document_id = p_target_document_id;
  if p_amount_minor > coalesce(v_balance, 0) then
    raise exception 'allocate_logistics: % exceeds the % still owed on this document', p_amount_minor, coalesce(v_balance, 0)
      using errcode = '22003';
  end if;

  select amount_minor - coalesce((select sum(amount_minor) from public.logistics_allocations where payment_id = p_payment_id), 0),
         direction
    into v_available, v_p_dir
    from public.logistics_payments where id = p_payment_id and org_id = v_org;
  if v_available is null then
    raise exception 'allocate_logistics: payment not found in your organisation' using errcode = 'P0002';
  end if;
  if (v_p_dir = 'in' and v_target.direction <> 'receivable')
     or (v_p_dir = 'out' and v_target.direction <> 'payable') then
    raise exception 'allocate_logistics: a % payment cannot be applied to a % document', v_p_dir, v_target.direction
      using errcode = '23514';
  end if;
  if p_amount_minor > v_available then
    raise exception 'allocate_logistics: % exceeds the % still unapplied on this payment', p_amount_minor, v_available
      using errcode = '22003';
  end if;

  insert into public.logistics_allocations (org_id, target_document_id, payment_id, amount_minor, created_by)
  values (v_org, p_target_document_id, p_payment_id, p_amount_minor, v_uid)
  returning id into v_id;

  return query select v_id;
end;
$$;

revoke execute on function public.allocate_logistics(uuid, bigint, uuid) from public;
grant  execute on function public.allocate_logistics(uuid, bigint, uuid) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.allocate_logistics(uuid, bigint, uuid);
-- drop function if exists public.record_logistics_payment(text, uuid, bigint, date, text, jsonb, text);
-- drop function if exists public.issue_logistics_document(text, uuid, date, bigint, bigint, jsonb, uuid[], text, date, text, text);
-- drop function if exists public.record_logistics_activity(text, uuid, date, bigint, uuid, text, text, text, text, text, text, text, bigint);
-- drop function if exists public.next_logistics_doc_number(text, date);
-- drop view if exists public.logistics_payment_balances;
-- drop view if exists public.logistics_document_balances;
-- drop table if exists public.logistics_allocations;
-- drop table if exists public.logistics_payments;
-- drop table if exists public.logistics_document_taxes;
-- drop table if exists public.logistics_document_lines;
-- drop table if exists public.logistics_documents;
-- drop table if exists public.logistics_document_sequences;
-- drop table if exists public.logistics_document_series;
-- drop table if exists public.logistics_activities;
-- alter table public.organisations drop column if exists vertical;

-- ═══════════════════════════════════════════════════════════════════════════
-- NOT YET PORTED (follow-up work, not this migration):
--   - Credit/debit notes and cancellation for logistics_documents
--   - PDF rendering (logistics_documents.issued_snapshot is written by
--     the application layer at issue time, same as the shared engine, but
--     no renderer route exists yet for this vertical)
--   - A migration moving existing freight-template org data (e.g. the demo
--     "Sahyadri Roadlines" org) from the shared tables onto this ledger —
--     deliberately separate from schema creation, see next migration.
-- ═══════════════════════════════════════════════════════════════════════════
