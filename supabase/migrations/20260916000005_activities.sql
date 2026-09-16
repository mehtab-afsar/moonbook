-- ═══════════════════════════════════════════════════════════════════════════
-- 05 · Activity types, fields, and activities — the configurable layer
--
-- THE LOAD-BEARING SPLIT (CONVENTIONS.md section 0). An activity carries a
-- TYPED SPINE — party, date, amount, currency, direction, status — in real
-- indexed columns, and everything industry-specific in `details jsonb`.
-- Every balance, view and report reads the spine ONLY. That is what lets one
-- deployed schema serve a freight operator and a scrap yard without the
-- financial core knowing which it is looking at.
--
-- The engine that makes `details` useful — dynamic forms, the validation
-- trigger, pricing strategies, dimension mirroring — is Phase 2. This
-- migration lays the tables so documents can reference activities, and seeds
-- nothing.
--
-- activity_types with org_id IS NULL are system-owned industry templates:
-- readable by everyone, writable by no tenant, copied into an org by
-- apply_industry_template() (Phase 3).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.activity_types (
  id               uuid primary key default gen_random_uuid(),
  -- NULL = system template. Set = a tenant's own copy.
  org_id           uuid references public.organisations(id) on delete cascade,
  template_key     text,
  key              text not null
                   constraint activity_types_key_fmt_chk check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label_singular   text not null,
  label_plural     text not null,

  direction        text not null
                   constraint activity_types_direction_chk
                   check (direction in ('receivable', 'payable')),

  pricing_strategy text not null default 'manual'
                   constraint activity_types_pricing_chk
                   check (pricing_strategy in ('manual', 'flat', 'quantity_rate')),
  pricing_config   jsonb not null default '{}'::jsonb
                   constraint activity_types_pricing_config_chk
                   check (jsonb_typeof(pricing_config) = 'object'),

  -- Which field currently mirrors into activities.dim1_value. Changing it
  -- makes historical rows stale rather than wrong, because the row stores the
  -- key it was captured under — see activities.dim1_key.
  dim1_field_key   text,

  -- Gates period_start/period_end in the UI. Only rental-shaped work needs them.
  uses_period      boolean not null default false,

  -- False for trading businesses. 500kg of material bought on Monday does not
  -- map to the batch sold on Friday, so per-activity margin there is fiction;
  -- margin is period-level only. See CONVENTIONS.md and the build plan.
  uses_job_margin  boolean not null default true,

  sort_order       integer not null default 0,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Composite targets so child rows can pin type identity in the schema
  -- rather than in a trigger. See the FKs on activities below.
  constraint activity_types_id_direction_uniq unique (id, direction),
  constraint activity_types_id_org_uniq       unique (id, org_id)
);

create unique index if not exists activity_types_org_key_uniq
  on public.activity_types (org_id, key) where org_id is not null;
create unique index if not exists activity_types_system_key_uniq
  on public.activity_types (key) where org_id is null;

comment on table public.activity_types is
  'What a business bills for. org_id IS NULL marks a system-owned industry template, readable by all tenants and writable by none.';

drop trigger if exists activity_types_updated_at on public.activity_types;
create trigger activity_types_updated_at before update on public.activity_types
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- activity_fields — the schema of the descriptive body.
--
-- Append-only: archive, never delete. An issued document must always have a
-- field definition to render the details it froze against.
--
-- Six field types, not eleven. Each costs five surfaces — form widget, zod
-- branch, PDF renderer, filter control, trigger branch — so the set stays
-- closed until a real customer needs a seventh.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.activity_fields (
  id               uuid primary key default gen_random_uuid(),
  activity_type_id uuid not null references public.activity_types(id) on delete cascade,
  org_id           uuid references public.organisations(id) on delete cascade,
  key              text not null
                   constraint activity_fields_key_fmt_chk check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label            text not null,
  field_type       text not null
                   constraint activity_fields_type_chk
                   check (field_type in ('text', 'long_text', 'number', 'date', 'select', 'boolean')),
  options          jsonb not null default '[]'::jsonb
                   constraint activity_fields_options_type_chk check (jsonb_typeof(options) = 'array'),
  is_required      boolean not null default false,
  is_reportable    boolean not null default false,
  show_on_document boolean not null default true,
  sort_order       integer not null default 0,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),

  constraint activity_fields_options_chk
    check (field_type <> 'select' or jsonb_array_length(options) > 0),
  -- A field can only belong to a type owned by the same org (or to a system
  -- template, where both are NULL).
  constraint activity_fields_type_org_fk
    foreign key (activity_type_id, org_id) references public.activity_types (id, org_id)
);

create unique index if not exists activity_fields_type_key_uniq
  on public.activity_fields (activity_type_id, key);
create index if not exists activity_fields_type_idx
  on public.activity_fields (activity_type_id, sort_order) where archived_at is null;

comment on table public.activity_fields is
  'The schema of activities.details, per activity type. Append-only: archived, never deleted, so an issued document can always be rendered against the definitions it was captured under.';

-- ───────────────────────────────────────────────────────────────────────────
-- activities — the typed spine
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.activities (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organisations(id) on delete cascade,
  activity_type_id  uuid not null references public.activity_types(id) on delete restrict,

  -- Who the work was done for/with. bill_to_party_id overrides who gets the
  -- document when those differ — a broker's head office, say. It lives here
  -- rather than only on the document because the operator knows it at
  -- data-entry time, and because "who should I invoice next" has to group by
  -- the party that will actually be billed.
  party_id          uuid not null references public.parties(id) on delete restrict,
  bill_to_party_id  uuid references public.parties(id) on delete restrict,

  direction         text not null
                    constraint activities_direction_chk
                    check (direction in ('receivable', 'payable')),
  currency          char(3) not null
                    constraint activities_currency_chk check (currency ~ '^[A-Z]{3}$'),

  occurred_on       date not null,
  -- Gated by activity_types.uses_period. Real columns, not details keys,
  -- because "what is on hire right now" is an indexed comparison and a date
  -- typed into jsonb sorts as a string.
  period_start      date,
  period_end        date,

  amount_minor      bigint not null
                    constraint activities_amount_chk check (amount_minor >= 0),
  direct_cost_minor bigint
                    constraint activities_cost_chk
                    check (direct_cost_minor is null or direct_cost_minor >= 0),

  reference         text,
  status            text not null default 'pending'
                    constraint activities_status_chk
                    check (status in ('pending', 'completed', 'invoiced', 'cancelled')),

  -- The reportable field, mirrored for fast GROUP BY. The KEY is stored next
  -- to the value: without it, repointing is_reportable at row 10,000 leaves
  -- one column holding two meanings and every historical report silently
  -- wrong while looking fine.
  dim1_key          text,
  dim1_value        text,

  details           jsonb not null default '{}'::jsonb
                    constraint activities_details_obj_chk check (jsonb_typeof(details) = 'object'),
  notes             text,

  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint activities_period_chk
    check (period_start is null or period_end is null or period_end >= period_start),
  constraint activities_dim1_chk check (dim1_value is null or dim1_key is not null),

  -- Schema instead of code. (activity_type_id, direction) means direction can
  -- never disagree with its type — a denormalised, indexable column with no
  -- drift risk and no trigger. (activity_type_id, org_id) means an activity
  -- can only use a type its own org owns; since templates have org_id IS NULL
  -- and activities have org_id NOT NULL, it is structurally impossible to
  -- record an activity against a system template without copying it first.
  constraint activities_type_direction_fk
    foreign key (activity_type_id, direction) references public.activity_types (id, direction),
  constraint activities_type_org_fk
    foreign key (activity_type_id, org_id) references public.activity_types (id, org_id)
);

create index if not exists activities_org_occurred_idx
  on public.activities (org_id, occurred_on desc);
create index if not exists activities_party_idx on public.activities (party_id);
create index if not exists activities_billable_idx
  on public.activities (org_id, direction, coalesce(bill_to_party_id, party_id))
  where status = 'completed';
create index if not exists activities_dim1_idx
  on public.activities (org_id, activity_type_id, dim1_value) where dim1_value is not null;
create index if not exists activities_details_gin
  on public.activities using gin (details jsonb_path_ops);
create index if not exists activities_on_hire_idx
  on public.activities (org_id, period_end)
  where period_end is not null and status <> 'cancelled';

comment on table public.activities is
  'The typed spine: one billable unit of work. Financial logic reads only the typed columns; `details` is descriptive and is never summed.';
comment on column public.activities.dim1_key is
  'The activity_fields.key that dim1_value was captured under. Stored so that repointing the reportable field leaves history detectable rather than silently mixed.';

drop trigger if exists activities_updated_at on public.activities;
create trigger activities_updated_at before update on public.activities
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- RLS
--
-- Templates need an explicit `or org_id is null` on SELECT: the plain
-- tenancy predicate evaluates to NULL for them, which is not TRUE, so they
-- would be invisible rather than shared. That disjunct is deliberately absent
-- from the write policy, which is what makes templates read-only to tenants.
--
-- activities has NO direct write policy — writes go through record_activity()
-- (Phase 2). This is a deliberate correction of LedgerFlow, whose
-- service_completions granted direct insert/update, making its "all writes go
-- through an RPC" claim untrue in practice.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.activity_types  enable row level security;
alter table public.activity_fields enable row level security;
alter table public.activities      enable row level security;

drop policy if exists "activity_types_select" on public.activity_types;
create policy "activity_types_select" on public.activity_types
  for select to authenticated
  using (org_id = (select public.current_org_id()) or org_id is null);

drop policy if exists "activity_types_write" on public.activity_types;
create policy "activity_types_write" on public.activity_types
  for all to authenticated
  using      (org_id = (select public.current_org_id()) and (select public.has_role('owner')))
  with check (org_id = (select public.current_org_id()) and (select public.has_role('owner')));

drop policy if exists "activity_fields_select" on public.activity_fields;
create policy "activity_fields_select" on public.activity_fields
  for select to authenticated
  using (org_id = (select public.current_org_id()) or org_id is null);

drop policy if exists "activity_fields_write" on public.activity_fields;
create policy "activity_fields_write" on public.activity_fields
  for all to authenticated
  using      (org_id = (select public.current_org_id()) and (select public.has_role('owner')))
  with check (org_id = (select public.current_org_id()) and (select public.has_role('owner')));

drop policy if exists "activities_select" on public.activities;
create policy "activities_select" on public.activities
  for select to authenticated using (org_id = (select public.current_org_id()));

revoke all on public.activity_types  from anon;
revoke all on public.activity_fields from anon;
revoke all on public.activities      from anon;

grant select, insert, update, delete on public.activity_types  to authenticated;
grant select, insert, update, delete on public.activity_fields to authenticated;
grant select                          on public.activities      to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop table if exists public.activities;
-- drop table if exists public.activity_fields;
-- drop table if exists public.activity_types;
