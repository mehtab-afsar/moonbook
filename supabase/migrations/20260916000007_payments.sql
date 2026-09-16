-- ═══════════════════════════════════════════════════════════════════════════
-- 07 · Payments and allocations
--
-- A payment is money that moved; an allocation is that money applied against
-- a specific document. Two tables, not payments.document_id, because a single
-- bank transfer routinely settles several invoices at once — the case a
-- one-payment-per-invoice model cannot represent, and the first one a real
-- customer hits.
--
-- ONE allocation table handles both ways a document balance goes down:
--
--   payment_id set          — cash was received or paid out
--   credit_document_id set  — a credit note offsets an invoice
--
-- A CREDIT NOTE IS NOT CASH AND MUST NOT LIVE IN THE CASH TABLE. If it were a
-- payments row, then "cash collected this month", bank reconciliation and any
-- commission calculation would each be overstated by every credit note ever
-- issued — defensible only by remembering `and method <> 'credit_note'` in
-- every cash query, forever. Someone eventually forgets, and the wrong number
-- looks entirely plausible.
--
-- num_nonnulls(...) = 1 keeps real foreign keys on both branches rather than
-- a polymorphic source_id that loses referential integrity.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations(id) on delete cascade,
  direction    text not null
               constraint payments_direction_chk check (direction in ('in', 'out')),
  party_id     uuid not null references public.parties(id) on delete restrict,

  currency     char(3) not null
               constraint payments_currency_chk check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null
               constraint payments_amount_chk check (amount_minor > 0),

  paid_on      date not null default current_date,
  method       text not null
               constraint payments_method_chk
               check (method in ('cash', 'bank', 'card', 'online', 'cheque')),
  reference_no text,
  notes        text,
  attachment_path text,

  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

create index if not exists payments_org_idx on public.payments (org_id, paid_on desc);
create index if not exists payments_party_idx on public.payments (party_id);

comment on table public.payments is
  'Money that moved, in either direction. What it settled is in allocations — a payment may settle several documents, or none yet (unapplied).';

-- ───────────────────────────────────────────────────────────────────────────
-- allocations
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.allocations (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organisations(id) on delete cascade,
  target_document_id uuid not null references public.documents(id) on delete restrict,

  payment_id         uuid references public.payments(id) on delete cascade,
  credit_document_id uuid references public.documents(id) on delete restrict,

  amount_minor       bigint not null
                     constraint allocations_amount_chk check (amount_minor > 0),
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),

  constraint allocations_source_chk
    check (num_nonnulls(payment_id, credit_document_id) = 1),
  constraint allocations_not_self_chk
    check (credit_document_id is null or credit_document_id <> target_document_id)
);

create unique index if not exists allocations_payment_target_uniq
  on public.allocations (payment_id, target_document_id) where payment_id is not null;
create unique index if not exists allocations_credit_target_uniq
  on public.allocations (credit_document_id, target_document_id) where credit_document_id is not null;
create index if not exists allocations_target_idx on public.allocations (target_document_id);

comment on table public.allocations is
  'How much of a payment, or of a credit note, applies to a given document. One table for both, because the balance arithmetic is identical and two would drift.';

-- ───────────────────────────────────────────────────────────────────────────
-- RLS. Both SELECT-only: writes go through record_payment() and allocate()
-- (migration 09), which is where the over-allocation rule lives. A direct
-- insert could drive a document balance negative.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.payments    enable row level security;
alter table public.allocations enable row level security;

drop policy if exists "payments_select" on public.payments;
create policy "payments_select" on public.payments
  for select to authenticated using (org_id = (select public.current_org_id()));

drop policy if exists "allocations_select" on public.allocations;
create policy "allocations_select" on public.allocations
  for select to authenticated using (org_id = (select public.current_org_id()));

revoke all on public.payments    from anon;
revoke all on public.allocations from anon;

grant select on public.payments    to authenticated;
grant select on public.allocations to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop table if exists public.allocations;
-- drop table if exists public.payments;
