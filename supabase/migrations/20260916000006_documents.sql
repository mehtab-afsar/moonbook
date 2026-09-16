-- ═══════════════════════════════════════════════════════════════════════════
-- 06 · Documents, lines, and tax components
--
-- TWO ORTHOGONAL COLUMNS, and conflating them is the bug this design exists
-- to prevent:
--
--   direction  — WHICH LEDGER the counterparty sits in (receivable | payable)
--   doc_kind   — WHAT THE DOCUMENT DOES to that ledger's balance
--
-- A credit note against a customer invoice moves money toward the customer
-- but belongs to the RECEIVABLE ledger. Folding that into one column gives it
-- direction='payable' and pollutes payables ageing with money you do not owe
-- a supplier.
--
-- Amounts are ALWAYS POSITIVE, in both directions and all kinds. direction
-- picks the ledger; doc_kind decides whether the balance view adds or
-- subtracts. Signed amounts would force relaxing every >= 0 check, and those
-- checks do real work.
--
-- Tax lands in document_taxes — one row per component — never as
-- cgst/sgst/igst columns. India produces two rows or one, the UK produces one,
-- a tax-free org produces none, and no country ever needs a schema change.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations(id) on delete cascade,

  direction     text not null
                constraint documents_direction_chk
                check (direction in ('receivable', 'payable')),
  doc_kind      text not null
                constraint documents_kind_chk
                check (doc_kind in ('invoice', 'bill', 'credit_note', 'debit_note')),

  -- OUR number, allocated by next_doc_number(). NULL on a document the
  -- counterparty numbered — you do not number your supplier's bill.
  doc_no        text,
  -- THEIR number, for purchases.
  party_doc_no  text,

  doc_date      date not null default current_date,
  due_date      date,

  counterparty_id  uuid not null references public.parties(id) on delete restrict,
  -- Where goods/services actually went, when that differs from who is billed.
  ship_to_party_id uuid references public.parties(id) on delete restrict,
  counterparty_override_reason text,

  -- Set on a credit/debit note: the document it offsets.
  offsets_document_id uuid references public.documents(id) on delete restrict,

  status        text not null default 'draft'
                constraint documents_status_chk
                check (status in ('draft', 'issued', 'cancelled')),
  is_disputed   boolean not null default false,
  disputed_reason text,

  currency      char(3) not null
                constraint documents_currency_chk check (currency ~ '^[A-Z]{3}$'),
  taxable_value_minor bigint not null default 0
                constraint documents_taxable_chk check (taxable_value_minor >= 0),
  tax_treatment text not null default 'forward'
                constraint documents_tax_treatment_chk
                check (tax_treatment in ('forward', 'reverse_charge', 'exempt')),
  round_off_minor bigint not null default 0,
  total_minor   bigint not null default 0
                constraint documents_total_chk check (total_minor >= 0),

  notes         text,
  pdf_path      text,
  -- Frozen at issue: the exact data the document was generated from, so a
  -- later edit to a party's address can never change what an already-sent
  -- document is proven to say.
  issued_snapshot jsonb,

  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Receivable kinds and payable kinds never cross.
  constraint documents_kind_direction_chk check (
    (direction = 'receivable' and doc_kind in ('invoice', 'credit_note')) or
    (direction = 'payable'    and doc_kind in ('bill', 'debit_note'))),
  -- Every document is identified by someone's number.
  constraint documents_numbering_chk check (doc_no is not null or party_doc_no is not null),
  -- A note offsets exactly one document; an invoice or bill offsets nothing.
  constraint documents_offset_kind_chk check (
    (doc_kind in ('credit_note', 'debit_note')) = (offsets_document_id is not null))
);

create unique index if not exists documents_org_no_uniq
  on public.documents (org_id, doc_no) where doc_no is not null;

-- Catches the same supplier bill being keyed in twice — a bug class a
-- receivables-only schema cannot have, and one that pays real money out twice.
create unique index if not exists documents_party_no_uniq
  on public.documents (org_id, counterparty_id, doc_kind, party_doc_no)
  where party_doc_no is not null;

create index if not exists documents_ledger_idx
  on public.documents (org_id, direction, status);
create index if not exists documents_counterparty_idx
  on public.documents (counterparty_id);
create index if not exists documents_offsets_idx
  on public.documents (offsets_document_id) where offsets_document_id is not null;

comment on table public.documents is
  'Invoices, supplier bills, credit and debit notes. direction is which ledger the counterparty sits in; doc_kind is what the document does to that balance. Amounts are always positive.';
comment on column public.documents.issued_snapshot is
  'The data the document was generated from, frozen at issue. A later party edit can never change what an already-sent document says.';

drop trigger if exists documents_updated_at on public.documents;
create trigger documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- document_lines
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.document_lines (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organisations(id) on delete cascade,
  document_id    uuid not null references public.documents(id) on delete cascade,
  -- NULL on a free-form line. Set when the line bills a recorded activity.
  activity_id    uuid references public.activities(id) on delete restrict,

  description    text not null,
  hsn_sac        text,
  quantity       numeric(12,2),
  unit           text,
  rate_minor     bigint,
  discount_minor bigint not null default 0
                 constraint document_lines_discount_chk check (discount_minor >= 0),
  amount_minor   bigint not null
                 constraint document_lines_amount_chk check (amount_minor >= 0),
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now()
);

-- Double-billing prevention at the storage layer: an activity can appear on at
-- most one document line, ever.
create unique index if not exists document_lines_activity_uniq
  on public.document_lines (activity_id) where activity_id is not null;
create index if not exists document_lines_document_idx
  on public.document_lines (document_id, sort_order);

comment on index public.document_lines_activity_uniq is
  'One activity bills at most once, enforced by the database rather than by the application remembering.';

-- ───────────────────────────────────────────────────────────────────────────
-- document_taxes — one row per tax component
--
-- Append-only alongside its document: no updated_at, no UPDATE grant. A tax
-- breakdown is rewritten by replacing the rows, not by editing them.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.document_taxes (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organisations(id) on delete cascade,
  document_id     uuid not null references public.documents(id) on delete cascade,
  component_code  text not null,   -- 'CGST' | 'SGST' | 'IGST' | 'VAT' | ...
  component_label text not null,   -- what prints: "CGST 9%"
  rate_pct        numeric(5,2) not null
                  constraint document_taxes_rate_chk check (rate_pct >= 0 and rate_pct <= 100),
  amount_minor    bigint not null
                  constraint document_taxes_amount_chk check (amount_minor >= 0),
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists document_taxes_document_idx
  on public.document_taxes (document_id, sort_order);

comment on table public.document_taxes is
  'One row per tax component on a document. Two rows for Indian intra-state GST, one for IGST or VAT, none for a tax-free organisation — no schema change per country.';

-- ───────────────────────────────────────────────────────────────────────────
-- RLS. All three are SELECT-only for clients: documents are created and
-- changed exclusively through issue_document()/cancel_document() (migration
-- 09), so numbering, tax and the frozen snapshot cannot be bypassed by a
-- direct table write.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.documents      enable row level security;
alter table public.document_lines enable row level security;
alter table public.document_taxes enable row level security;

drop policy if exists "documents_select" on public.documents;
create policy "documents_select" on public.documents
  for select to authenticated using (org_id = (select public.current_org_id()));

drop policy if exists "document_lines_select" on public.document_lines;
create policy "document_lines_select" on public.document_lines
  for select to authenticated using (org_id = (select public.current_org_id()));

drop policy if exists "document_taxes_select" on public.document_taxes;
create policy "document_taxes_select" on public.document_taxes
  for select to authenticated using (org_id = (select public.current_org_id()));

revoke all on public.documents      from anon;
revoke all on public.document_lines from anon;
revoke all on public.document_taxes from anon;

grant select on public.documents      to authenticated;
grant select on public.document_lines to authenticated;
grant select on public.document_taxes to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop table if exists public.document_taxes;
-- drop table if exists public.document_lines;
-- drop table if exists public.documents;
