-- ═══════════════════════════════════════════════════════════════════════════
-- 28 · The plastics (scrap & recycling) vertical's own ledger
--
-- Second fork of the per-vertical split, same template as logistics
-- (migration 26): its own activities/documents/payments/allocations tables,
-- own numbering, own RLS. ADDITIVE ONLY — nothing here touches the shared
-- engine or the logistics fork.
--
-- The one real difference from logistics: scrap bills in BOTH directions as
-- its normal case (buy by weight from a collector, sell on by weight to a
-- processor) and prices by weight × rate rather than manual entry. Amount is
-- still computed once, server-side, by lib/pricing's quantity_rate strategy
-- — reused as-is, because it is pure arithmetic with no vertical branching,
-- the same reasoning that keeps current_org_id() and lib/tax shared.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  alter table public.organisations drop constraint if exists organisations_vertical_chk;
  if not exists (
    select 1 from pg_constraint where conname = 'organisations_vertical_chk'
  ) then
    alter table public.organisations
      add constraint organisations_vertical_chk check (vertical in ('shared', 'logistics', 'plastics'));
  end if;
end $$;

create table if not exists public.plastics_activities (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organisations(id) on delete cascade,
  party_id          uuid not null,
  bill_to_party_id  uuid,
  direction         text not null
                    constraint plastics_activities_direction_chk check (direction in ('receivable', 'payable')),
  occurred_on       date not null,
  currency          char(3) not null,
  amount_minor      bigint not null
                    constraint plastics_activities_amount_chk check (amount_minor >= 0),
  direct_cost_minor bigint
                    constraint plastics_activities_cost_chk check (direct_cost_minor is null or direct_cost_minor >= 0),

  material          text not null,
  grade             text
                    constraint plastics_activities_grade_chk check (grade is null or grade in ('A', 'B', 'C', 'Mixed')),
  net_weight_kg     numeric(12,2) not null constraint plastics_activities_weight_chk check (net_weight_kg > 0),
  rate_per_kg_minor bigint not null constraint plastics_activities_rate_chk check (rate_per_kg_minor >= 0),
  ticket_no         text,
  vehicle_no        text,

  reference         text,
  notes             text,
  attachment_path   text,
  status            text not null default 'completed'
                    constraint plastics_activities_status_chk
                    check (status in ('pending', 'completed', 'invoiced', 'cancelled')),

  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint plastics_activities_party_org_fk
    foreign key (party_id, org_id) references public.parties (id, org_id),
  constraint plastics_activities_bill_to_org_fk
    foreign key (bill_to_party_id, org_id) references public.parties (id, org_id)
);

create index if not exists plastics_activities_org_idx on public.plastics_activities (org_id, occurred_on desc);

comment on table public.plastics_activities is
  'Scrap & recycling: material bought (payable) and sold (receivable), priced by weight x rate.';

drop trigger if exists plastics_activities_updated_at on public.plastics_activities;
create trigger plastics_activities_updated_at before update on public.plastics_activities
  for each row execute function public.set_updated_at();

alter table public.plastics_activities enable row level security;
drop policy if exists "plastics_activities_select" on public.plastics_activities;
create policy "plastics_activities_select" on public.plastics_activities
  for select to authenticated using (org_id = (select public.current_org_id()));
revoke all on public.plastics_activities from anon;
grant select on public.plastics_activities to authenticated;
grant select, insert, update on public.plastics_activities to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Numbering, documents, payments, allocations — identical shape to the
-- logistics fork (migration 26), own table, own sequence space.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.plastics_document_series (
  org_id            uuid not null references public.organisations(id) on delete cascade,
  doc_kind          text not null constraint plastics_document_series_kind_chk check (doc_kind in ('invoice', 'bill')),
  prefix            text not null constraint plastics_document_series_prefix_chk check (prefix ~ '^[A-Z]{2,6}$'),
  is_self_numbered  boolean not null default true,
  updated_at        timestamptz not null default now(),
  primary key (org_id, doc_kind)
);

drop trigger if exists plastics_document_series_updated_at on public.plastics_document_series;
create trigger plastics_document_series_updated_at before update on public.plastics_document_series
  for each row execute function public.set_updated_at();

create table if not exists public.plastics_document_sequences (
  org_id      uuid not null references public.organisations(id) on delete cascade,
  doc_kind    text not null,
  period_key  text not null,
  last_value  integer not null default 0,
  primary key (org_id, doc_kind, period_key)
);

alter table public.plastics_document_series enable row level security;
drop policy if exists "plastics_document_series_select" on public.plastics_document_series;
create policy "plastics_document_series_select" on public.plastics_document_series
  for select to authenticated using (org_id = (select public.current_org_id()));
revoke all on public.plastics_document_series from anon;
grant select on public.plastics_document_series to authenticated;
grant select, insert, update on public.plastics_document_series to service_role;

alter table public.plastics_document_sequences enable row level security;
revoke all on public.plastics_document_sequences from anon, authenticated;
grant select, insert, update on public.plastics_document_sequences to service_role;

create or replace function public.next_plastics_doc_number(p_doc_kind text, p_doc_date date)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org      uuid := (select public.current_org_id());
  v_prefix   text;
  v_self     boolean;
  v_period   text;
  v_seq      integer;
  v_fy_start integer;
begin
  if v_org is null then
    raise exception 'next_plastics_doc_number: no organisation for this account' using errcode = '28000';
  end if;
  if p_doc_kind not in ('invoice', 'bill') then
    raise exception 'next_plastics_doc_number: unknown doc_kind %', p_doc_kind using errcode = '22023';
  end if;

  select prefix, is_self_numbered into v_prefix, v_self
    from public.plastics_document_series where org_id = v_org and doc_kind = p_doc_kind;
  if v_prefix is null then
    raise exception 'next_plastics_doc_number: no % series configured for this organisation', p_doc_kind
      using errcode = 'P0002';
  end if;
  if not v_self then
    raise exception 'next_plastics_doc_number: the % series is not self-numbered — record the counterparty''s number instead', p_doc_kind
      using errcode = '22023';
  end if;

  select fiscal_year_start_month into v_fy_start from public.organisations where id = v_org;
  v_period := public.fiscal_year_code(p_doc_date, v_fy_start);

  insert into public.plastics_document_sequences as ds (org_id, doc_kind, period_key, last_value)
  values (v_org, p_doc_kind, v_period, 1)
  on conflict (org_id, doc_kind, period_key)
  do update set last_value = ds.last_value + 1
  returning last_value into v_seq;

  return v_prefix || '/' || v_period || '/' || lpad(v_seq::text, 4, '0');
end;
$$;

revoke execute on function public.next_plastics_doc_number(text, date) from public;
grant  execute on function public.next_plastics_doc_number(text, date) to authenticated;

create table if not exists public.plastics_documents (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organisations(id) on delete cascade,
  direction         text not null check (direction in ('receivable', 'payable')),
  doc_kind          text not null check (doc_kind in ('invoice', 'bill')),
  doc_no            text,
  party_doc_no      text,
  doc_date          date not null,
  due_date          date,
  counterparty_id   uuid not null,
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

  constraint plastics_documents_counterparty_org_fk
    foreign key (counterparty_id, org_id) references public.parties (id, org_id),
  constraint plastics_documents_kind_direction_chk
    check ((doc_kind = 'invoice' and direction = 'receivable') or (doc_kind = 'bill' and direction = 'payable'))
);

create unique index if not exists plastics_documents_org_doc_no_uniq
  on public.plastics_documents (org_id, doc_kind, doc_no) where doc_no is not null;
create unique index if not exists plastics_documents_party_no_uniq
  on public.plastics_documents (org_id, counterparty_id, party_doc_no) where party_doc_no is not null;
create index if not exists plastics_documents_org_idx on public.plastics_documents (org_id, doc_date desc);

alter table public.plastics_documents enable row level security;
drop policy if exists "plastics_documents_select" on public.plastics_documents;
create policy "plastics_documents_select" on public.plastics_documents
  for select to authenticated using (org_id = (select public.current_org_id()));
revoke all on public.plastics_documents from anon;
grant select on public.plastics_documents to authenticated;
grant select, insert, update on public.plastics_documents to service_role;

create table if not exists public.plastics_document_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations(id) on delete cascade,
  document_id   uuid not null references public.plastics_documents(id) on delete cascade,
  activity_id   uuid references public.plastics_activities(id) on delete restrict,
  description   text not null,
  amount_minor  bigint not null check (amount_minor >= 0),
  sort_order    integer not null default 0
);

create unique index if not exists plastics_document_lines_activity_uniq
  on public.plastics_document_lines (activity_id) where activity_id is not null;

alter table public.plastics_document_lines enable row level security;
drop policy if exists "plastics_document_lines_select" on public.plastics_document_lines;
create policy "plastics_document_lines_select" on public.plastics_document_lines
  for select to authenticated using (org_id = (select public.current_org_id()));
revoke all on public.plastics_document_lines from anon;
grant select on public.plastics_document_lines to authenticated;
grant select, insert on public.plastics_document_lines to service_role;

create table if not exists public.plastics_document_taxes (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organisations(id) on delete cascade,
  document_id       uuid not null references public.plastics_documents(id) on delete cascade,
  component_code    text not null,
  component_label   text not null,
  rate_pct          numeric(5,2) not null,
  amount_minor      bigint not null check (amount_minor >= 0)
);

alter table public.plastics_document_taxes enable row level security;
drop policy if exists "plastics_document_taxes_select" on public.plastics_document_taxes;
create policy "plastics_document_taxes_select" on public.plastics_document_taxes
  for select to authenticated using (org_id = (select public.current_org_id()));
revoke all on public.plastics_document_taxes from anon;
grant select on public.plastics_document_taxes to authenticated;
grant select, insert on public.plastics_document_taxes to service_role;

create table if not exists public.plastics_payments (
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

  constraint plastics_payments_party_org_fk
    foreign key (party_id, org_id) references public.parties (id, org_id)
);

create index if not exists plastics_payments_org_idx on public.plastics_payments (org_id, paid_on desc);

alter table public.plastics_payments enable row level security;
drop policy if exists "plastics_payments_select" on public.plastics_payments;
create policy "plastics_payments_select" on public.plastics_payments
  for select to authenticated using (org_id = (select public.current_org_id()));
revoke all on public.plastics_payments from anon;
grant select on public.plastics_payments to authenticated;
grant select, insert on public.plastics_payments to service_role;

create table if not exists public.plastics_allocations (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organisations(id) on delete cascade,
  target_document_id    uuid not null references public.plastics_documents(id) on delete restrict,
  payment_id            uuid references public.plastics_payments(id) on delete restrict,
  amount_minor          bigint not null check (amount_minor > 0),
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),

  constraint plastics_allocations_payment_chk check (payment_id is not null)
);

alter table public.plastics_allocations enable row level security;
drop policy if exists "plastics_allocations_select" on public.plastics_allocations;
create policy "plastics_allocations_select" on public.plastics_allocations
  for select to authenticated using (org_id = (select public.current_org_id()));
revoke all on public.plastics_allocations from anon;
grant select on public.plastics_allocations to authenticated;
grant select, insert on public.plastics_allocations to service_role;

create or replace view public.plastics_document_balances
with (security_invoker = true) as
select
  d.id as document_id, d.org_id, d.direction, d.doc_kind, d.counterparty_id,
  d.doc_no, d.party_doc_no, d.doc_date, d.due_date, d.currency, d.total_minor,
  coalesce(p.settled_minor, 0) as settled_minor,
  d.total_minor - coalesce(p.settled_minor, 0) as balance_due_minor
from public.plastics_documents d
left join (
  select target_document_id, sum(amount_minor) as settled_minor
    from public.plastics_allocations group by target_document_id
) p on p.target_document_id = d.id
where d.status = 'issued';

grant select on public.plastics_document_balances to authenticated;
revoke all on public.plastics_document_balances from anon;

create or replace view public.plastics_payment_balances
with (security_invoker = true) as
select
  p.id as payment_id, p.org_id, p.direction, p.party_id, p.currency, p.paid_on, p.amount_minor,
  coalesce(a.applied_minor, 0) as applied_minor,
  p.amount_minor - coalesce(a.applied_minor, 0) as unapplied_minor
from public.plastics_payments p
left join (
  select payment_id, sum(amount_minor) as applied_minor
    from public.plastics_allocations group by payment_id
) a on a.payment_id = p.id;

grant select on public.plastics_payment_balances to authenticated;
revoke all on public.plastics_payment_balances from anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPCs — record, issue, pay, allocate. Amount for record_plastics_activity is
-- computed by the CALLER (lib/pricing's quantity_rate, in TypeScript) and
-- passed in already resolved, exactly as the shared engine's
-- POST /api/activities does — this RPC does not recompute weight x rate.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.record_plastics_activity(
  p_direction         text,
  p_party_id          uuid,
  p_occurred_on       date,
  p_amount_minor      bigint,
  p_material          text,
  p_net_weight_kg     numeric,
  p_rate_per_kg_minor bigint,
  p_bill_to_party_id  uuid default null,
  p_grade             text default null,
  p_ticket_no         text default null,
  p_vehicle_no        text default null,
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
    raise exception 'record_plastics_activity: no organisation for this account' using errcode = '28000';
  end if;
  if p_direction not in ('receivable', 'payable') then
    raise exception 'record_plastics_activity: direction must be receivable or payable' using errcode = '22023';
  end if;
  if not exists (select 1 from public.parties where id = p_party_id and org_id = v_org) then
    raise exception 'record_plastics_activity: party not found in your organisation' using errcode = 'P0002';
  end if;
  if p_bill_to_party_id is not null
     and not exists (select 1 from public.parties where id = p_bill_to_party_id and org_id = v_org) then
    raise exception 'record_plastics_activity: bill-to party not found in your organisation' using errcode = 'P0002';
  end if;
  if p_amount_minor < 0 then
    raise exception 'record_plastics_activity: amount cannot be negative' using errcode = '22003';
  end if;
  if p_net_weight_kg <= 0 then
    raise exception 'record_plastics_activity: weight must be positive' using errcode = '22003';
  end if;

  insert into public.plastics_activities (
    org_id, party_id, bill_to_party_id, direction, occurred_on, currency, amount_minor,
    direct_cost_minor, material, grade, net_weight_kg, rate_per_kg_minor, ticket_no, vehicle_no,
    reference, notes, status, created_by
  )
  select v_org, p_party_id, p_bill_to_party_id, p_direction, p_occurred_on, o.base_currency, p_amount_minor,
         p_direct_cost_minor, p_material, p_grade, p_net_weight_kg, p_rate_per_kg_minor, p_ticket_no, p_vehicle_no,
         nullif(p_reference, ''), nullif(p_notes, ''), 'completed', v_uid
    from public.organisations o where o.id = v_org
  returning id into v_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'plastics_activity.recorded', 'plastics_activity', v_id,
          jsonb_build_object('direction', p_direction, 'amount_minor', p_amount_minor));

  return query select v_id;
end;
$$;

revoke execute on function public.record_plastics_activity(text, uuid, date, bigint, text, numeric, bigint, uuid, text, text, text, text, text, bigint) from public;
grant  execute on function public.record_plastics_activity(text, uuid, date, bigint, text, numeric, bigint, uuid, text, text, text, text, text, bigint) to authenticated;

create or replace function public.issue_plastics_document(
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
  v_sort      integer := 0;
  v_tax       jsonb;
  v_activity  uuid;
  v_count     integer;
begin
  if v_org is null then
    raise exception 'issue_plastics_document: no organisation for this account' using errcode = '28000';
  end if;
  if not (select public.has_role('owner')) then
    raise exception 'issue_plastics_document: requires the owner role' using errcode = '42501';
  end if;
  if p_doc_kind not in ('invoice', 'bill') then
    raise exception 'issue_plastics_document: doc_kind must be invoice or bill' using errcode = '22023';
  end if;

  v_direction := case p_doc_kind when 'invoice' then 'receivable' else 'payable' end;

  if not exists (select 1 from public.parties where id = p_counterparty_id and org_id = v_org) then
    raise exception 'issue_plastics_document: counterparty not found in your organisation' using errcode = 'P0002';
  end if;
  if p_total_minor < 0 or p_taxable_value_minor < 0 then
    raise exception 'issue_plastics_document: amounts cannot be negative' using errcode = '22003';
  end if;

  select base_currency into v_currency from public.organisations where id = v_org;
  select is_self_numbered into v_self
    from public.plastics_document_series where org_id = v_org and doc_kind = p_doc_kind;
  if v_self is null then
    raise exception 'issue_plastics_document: no % series configured for this organisation', p_doc_kind
      using errcode = 'P0002';
  end if;

  if v_self then
    v_doc_no := public.next_plastics_doc_number(p_doc_kind, p_doc_date);
  elsif nullif(p_party_doc_no, '') is null then
    raise exception 'issue_plastics_document: the % series is not self-numbered, so the counterparty''s document number is required', p_doc_kind
      using errcode = '22004';
  end if;

  if array_length(p_activity_ids, 1) > 0 then
    select count(*) into v_count
      from (
        select id from public.plastics_activities
         where id = any(p_activity_ids) and org_id = v_org and direction = v_direction and status = 'completed'
         for update
      ) locked;
    if v_count <> array_length(p_activity_ids, 1) then
      raise exception 'issue_plastics_document: one or more activities are not billable' using errcode = '23514';
    end if;
    if exists (select 1 from public.plastics_document_lines where activity_id = any(p_activity_ids)) then
      raise exception 'issue_plastics_document: one or more activities have already been billed' using errcode = '23505';
    end if;
  end if;

  insert into public.plastics_documents (
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
      insert into public.plastics_document_lines (org_id, document_id, activity_id, description, amount_minor, sort_order)
      select v_org, v_doc_id, a.id,
             coalesce(a.material, 'Item') || ' — ' || a.net_weight_kg || 'kg' ||
               coalesce(' (' || a.grade || ')', ''),
             a.amount_minor, v_sort
        from public.plastics_activities a where a.id = v_activity;
      v_sort := v_sort + 1;
    end loop;
    update public.plastics_activities set status = 'invoiced' where id = any(p_activity_ids);
  end if;

  for v_tax in select * from jsonb_array_elements(coalesce(p_taxes, '[]'::jsonb)) loop
    insert into public.plastics_document_taxes (org_id, document_id, component_code, component_label, rate_pct, amount_minor)
    values (
      v_org, v_doc_id,
      v_tax ->> 'component_code', v_tax ->> 'component_label',
      (v_tax ->> 'rate_pct')::numeric, (v_tax ->> 'amount_minor')::bigint
    );
  end loop;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'plastics_document.issued', 'plastics_document', v_doc_id,
          jsonb_build_object('doc_kind', p_doc_kind, 'doc_no', v_doc_no, 'total_minor', p_total_minor));

  return query select v_doc_id, v_doc_no;
end;
$$;

revoke execute on function public.issue_plastics_document(text, uuid, date, bigint, bigint, jsonb, uuid[], text, date, text, text) from public;
grant  execute on function public.issue_plastics_document(text, uuid, date, bigint, bigint, jsonb, uuid[], text, date, text, text) to authenticated;

create or replace function public.record_plastics_payment(
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
    raise exception 'record_plastics_payment: no organisation for this account' using errcode = '28000';
  end if;
  if not (select public.has_role('owner')) then
    raise exception 'record_plastics_payment: requires the owner role' using errcode = '42501';
  end if;
  if p_direction not in ('in', 'out') then
    raise exception 'record_plastics_payment: direction must be in or out' using errcode = '22023';
  end if;
  if p_amount_minor <= 0 then
    raise exception 'record_plastics_payment: amount must be positive' using errcode = '22003';
  end if;
  if not exists (select 1 from public.parties where id = p_party_id and org_id = v_org) then
    raise exception 'record_plastics_payment: party not found in your organisation' using errcode = 'P0002';
  end if;

  select base_currency into v_currency from public.organisations where id = v_org;

  insert into public.plastics_payments (org_id, direction, party_id, currency, amount_minor, paid_on, method, reference_no, created_by)
  values (v_org, p_direction, p_party_id, v_currency, p_amount_minor, p_paid_on, p_method, nullif(p_reference_no, ''), v_uid)
  returning id into v_id;

  for v_alloc in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    perform public.allocate_plastics(
      (v_alloc ->> 'document_id')::uuid,
      (v_alloc ->> 'amount_minor')::bigint,
      v_id
    );
  end loop;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'plastics_payment.recorded', 'plastics_payment', v_id,
          jsonb_build_object('direction', p_direction, 'amount_minor', p_amount_minor));

  return query select v_id;
end;
$$;

revoke execute on function public.record_plastics_payment(text, uuid, bigint, date, text, jsonb, text) from public;
grant  execute on function public.record_plastics_payment(text, uuid, bigint, date, text, jsonb, text) to authenticated;

create or replace function public.allocate_plastics(
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
  v_target    public.plastics_documents;
  v_balance   bigint;
  v_available bigint;
  v_p_dir     text;
  v_id        uuid;
begin
  if v_org is null then
    raise exception 'allocate_plastics: no organisation for this account' using errcode = '28000';
  end if;
  if p_amount_minor <= 0 then
    raise exception 'allocate_plastics: amount must be positive' using errcode = '22003';
  end if;

  select * into v_target from public.plastics_documents
   where id = p_target_document_id and org_id = v_org and status = 'issued'
   for update;
  if v_target.id is null then
    raise exception 'allocate_plastics: target document not found or not issued' using errcode = 'P0002';
  end if;

  select balance_due_minor into v_balance
    from public.plastics_document_balances where document_id = p_target_document_id;
  if p_amount_minor > coalesce(v_balance, 0) then
    raise exception 'allocate_plastics: % exceeds the % still owed on this document', p_amount_minor, coalesce(v_balance, 0)
      using errcode = '22003';
  end if;

  select amount_minor - coalesce((select sum(amount_minor) from public.plastics_allocations where payment_id = p_payment_id), 0),
         direction
    into v_available, v_p_dir
    from public.plastics_payments where id = p_payment_id and org_id = v_org;
  if v_available is null then
    raise exception 'allocate_plastics: payment not found in your organisation' using errcode = 'P0002';
  end if;
  if (v_p_dir = 'in' and v_target.direction <> 'receivable')
     or (v_p_dir = 'out' and v_target.direction <> 'payable') then
    raise exception 'allocate_plastics: a % payment cannot be applied to a % document', v_p_dir, v_target.direction
      using errcode = '23514';
  end if;
  if p_amount_minor > v_available then
    raise exception 'allocate_plastics: % exceeds the % still unapplied on this payment', p_amount_minor, v_available
      using errcode = '22003';
  end if;

  insert into public.plastics_allocations (org_id, target_document_id, payment_id, amount_minor, created_by)
  values (v_org, p_target_document_id, p_payment_id, p_amount_minor, v_uid)
  returning id into v_id;

  return query select v_id;
end;
$$;

revoke execute on function public.allocate_plastics(uuid, bigint, uuid) from public;
grant  execute on function public.allocate_plastics(uuid, bigint, uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- NOT YET PORTED: credit/debit notes, cancellation, frozen-snapshot PDF
-- rendering — same scope cut as the logistics fork, see migration 26.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.allocate_plastics(uuid, bigint, uuid);
-- drop function if exists public.record_plastics_payment(text, uuid, bigint, date, text, jsonb, text);
-- drop function if exists public.issue_plastics_document(text, uuid, date, bigint, bigint, jsonb, uuid[], text, date, text, text);
-- drop function if exists public.record_plastics_activity(text, uuid, date, bigint, text, numeric, bigint, uuid, text, text, text, text, text, bigint);
-- drop function if exists public.next_plastics_doc_number(text, date);
-- drop view if exists public.plastics_payment_balances;
-- drop view if exists public.plastics_document_balances;
-- drop table if exists public.plastics_allocations, public.plastics_payments,
--   public.plastics_document_taxes, public.plastics_document_lines,
--   public.plastics_documents, public.plastics_document_sequences,
--   public.plastics_document_series, public.plastics_activities;
-- alter table public.organisations drop constraint if exists organisations_vertical_chk;
-- alter table public.organisations add constraint organisations_vertical_chk check (vertical in ('shared', 'logistics'));
