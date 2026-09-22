-- ═══════════════════════════════════════════════════════════════════════════
-- Relationships between activity types, and rollups over them — the two
-- items docs/ONTOLOGY.md named as unbuilt: "no relationship/link-type
-- concept exists" and "no computed/derived-property concept exists either."
--
-- RELATIONSHIPS: activity_link_types is config (which type links to which,
-- and what it's called) — activity_links is data (the actual link between
-- two specific activities). Same two-layer shape as activity_types/
-- activity_fields itself: a link type is a row an org can add via self-serve
-- RPC, same as a field; a link is a row created when someone actually
-- connects two activities.
--
-- COMPUTED PROPERTIES: deliberately NOT a formula language.
-- CONVENTIONS.md §10 is explicit about why this codebase has none — a
-- formula parser is an unbounded bug surface in a financial core. What ships
-- here instead is a CLOSED SET of aggregate kinds a link type can declare:
-- 'none' (default), 'sum_amount' (sum the linked activities' amount_minor),
-- 'count' (how many are linked). That is config deciding WHICH of a fixed,
-- reviewed set of computations applies — not config deciding what the
-- computation IS. If this table ever needs a fourth aggregate kind, that is
-- a migration adding one more reviewed case, same as a new pricing strategy
-- would be — never a stored expression evaluated at read time.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.activity_link_types (
  id                   uuid primary key default gen_random_uuid(),
  -- NULL = system template, same convention as activity_types.org_id.
  org_id               uuid references public.organisations(id) on delete cascade,
  from_activity_type_id uuid not null,
  to_activity_type_id   uuid not null,
  key                  text not null
                       constraint activity_link_types_key_fmt_chk check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  -- What prints and what the UI offers: "references", "fulfills", "corrects".
  label                text not null,
  aggregate            text not null default 'none'
                       constraint activity_link_types_aggregate_chk
                       check (aggregate in ('none', 'sum_amount', 'count')),
  archived_at          timestamptz,
  sort_order           integer not null default 0,
  created_at           timestamptz not null default now(),

  -- Both ends must belong to the SAME org this link type belongs to (or both
  -- be system-template types, when org_id is null) — the same composite-FK
  -- shape activity_fields already uses to pin a field to its type's org.
  constraint activity_link_types_from_org_fk
    foreign key (from_activity_type_id, org_id) references public.activity_types (id, org_id),
  constraint activity_link_types_to_org_fk
    foreign key (to_activity_type_id, org_id) references public.activity_types (id, org_id)
);

create unique index if not exists activity_link_types_key_uniq
  on public.activity_link_types (from_activity_type_id, key);
create index if not exists activity_link_types_org_idx
  on public.activity_link_types (org_id) where archived_at is null;

comment on table public.activity_link_types is
  'Which activity type can link to which, and what that relationship is called — config, same layer as activity_fields. Not the links themselves; see activity_links.';
comment on column public.activity_link_types.aggregate is
  'A CLOSED set of rollup kinds, not a formula — see this migration''s own header. none: no rollup shown. sum_amount: sum of linked activities'' amount_minor. count: how many are linked.';

alter table public.activity_link_types enable row level security;

drop policy if exists "activity_link_types_select" on public.activity_link_types;
create policy "activity_link_types_select" on public.activity_link_types
  for select to authenticated
  using (org_id = (select public.current_org_id()) or org_id is null);

drop policy if exists "activity_link_types_write" on public.activity_link_types;
create policy "activity_link_types_write" on public.activity_link_types
  for all to authenticated
  using      (org_id = (select public.current_org_id()) and (select public.has_role('owner')))
  with check (org_id = (select public.current_org_id()) and (select public.has_role('owner')));

revoke all on public.activity_link_types from anon;
grant select, insert, update, delete on public.activity_link_types to authenticated;
grant select, insert, update, delete on public.activity_link_types to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- activity_links — one actual link between two activities. Hard-deleted on
-- unlink, unlike activity_fields' archive-only rule: a link is a fact about
-- two specific activities right now ("this delivery references that PO"),
-- not a schema definition an issued document's snapshot depends on being
-- able to render later. Nothing freezes a link into any document snapshot.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.activity_links (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organisations(id) on delete cascade,
  link_type_id   uuid not null references public.activity_link_types(id) on delete cascade,
  from_activity_id uuid not null references public.activities(id) on delete cascade,
  to_activity_id   uuid not null references public.activities(id) on delete cascade,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),

  constraint activity_links_not_self_chk check (from_activity_id <> to_activity_id),
  constraint activity_links_uniq unique (link_type_id, from_activity_id, to_activity_id)
);

create index if not exists activity_links_from_idx on public.activity_links (from_activity_id);
create index if not exists activity_links_to_idx   on public.activity_links (to_activity_id);

comment on table public.activity_links is
  'One link between two of this org''s own activities, of a declared link type. Hard-deleted on unlink — see this migration''s own header for why that differs from activity_fields'' archive-only rule.';

alter table public.activity_links enable row level security;

drop policy if exists "activity_links_select" on public.activity_links;
create policy "activity_links_select" on public.activity_links
  for select to authenticated
  using (org_id = (select public.current_org_id()));

revoke all on public.activity_links from anon;
grant select on public.activity_links to authenticated;
grant select, insert, update, delete on public.activity_links to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- add_activity_link_type / archive_activity_link_type — self-serve, same
-- owner-only shape as add_activity_field / archive_activity_field.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.add_activity_link_type(
  p_from_activity_type_id uuid,
  p_to_activity_type_id   uuid,
  p_key                   text,
  p_label                 text,
  p_aggregate             text default 'none'
)
returns table (link_type_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org  uuid := (select public.current_org_id());
  v_uid  uuid := auth.uid();
  v_id   uuid;
  v_sort integer;
begin
  if v_org is null then
    raise exception 'add_activity_link_type: no organisation for this account' using errcode = '28000';
  end if;
  if not (select public.has_role('owner')) then
    raise exception 'add_activity_link_type: requires the owner role' using errcode = '42501';
  end if;
  if p_key !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'add_activity_link_type: key must be lowercase, start with a letter, and use only letters, numbers and underscores' using errcode = '22023';
  end if;
  if p_aggregate not in ('none', 'sum_amount', 'count') then
    raise exception 'add_activity_link_type: unknown aggregate %', p_aggregate using errcode = '22023';
  end if;
  if not exists (select 1 from public.activity_types t where t.id = p_from_activity_type_id and t.org_id = v_org) then
    raise exception 'add_activity_link_type: "from" activity type not found in your organisation' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.activity_types t where t.id = p_to_activity_type_id and t.org_id = v_org) then
    raise exception 'add_activity_link_type: "to" activity type not found in your organisation' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.activity_link_types lt
     where lt.from_activity_type_id = p_from_activity_type_id and lt.key = p_key and lt.archived_at is null
  ) then
    raise exception 'add_activity_link_type: a link type with that key already exists from this activity type' using errcode = '23505';
  end if;

  select coalesce(max(sort_order) + 1, 0) into v_sort
    from public.activity_link_types where from_activity_type_id = p_from_activity_type_id;

  insert into public.activity_link_types (org_id, from_activity_type_id, to_activity_type_id, key, label, aggregate, sort_order)
  values (v_org, p_from_activity_type_id, p_to_activity_type_id, p_key, p_label, p_aggregate, v_sort)
  returning id into v_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'activity_link_type.added', 'activity_link_type', v_id,
          jsonb_build_object('from_activity_type_id', p_from_activity_type_id, 'to_activity_type_id', p_to_activity_type_id, 'key', p_key));

  return query select v_id;
end;
$$;

revoke execute on function public.add_activity_link_type(uuid, uuid, text, text, text) from public;
grant  execute on function public.add_activity_link_type(uuid, uuid, text, text, text) to authenticated;

create or replace function public.archive_activity_link_type(
  p_link_type_id uuid
)
returns table (link_type_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org    uuid := (select public.current_org_id());
  v_uid    uuid := auth.uid();
  v_before jsonb;
begin
  if v_org is null then
    raise exception 'archive_activity_link_type: no organisation for this account' using errcode = '28000';
  end if;
  if not (select public.has_role('owner')) then
    raise exception 'archive_activity_link_type: requires the owner role' using errcode = '42501';
  end if;

  select to_jsonb(lt) into v_before
    from public.activity_link_types lt
   where lt.id = p_link_type_id and lt.org_id = v_org and lt.archived_at is null
   for update;

  if v_before is null then
    raise exception 'archive_activity_link_type: link type not found in your organisation, or already archived' using errcode = 'P0002';
  end if;

  update public.activity_link_types set archived_at = now() where id = p_link_type_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, before)
  values (v_org, v_uid, 'activity_link_type.archived', 'activity_link_type', p_link_type_id, v_before);

  return query select p_link_type_id;
end;
$$;

revoke execute on function public.archive_activity_link_type(uuid) from public;
grant  execute on function public.archive_activity_link_type(uuid) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- link_activities / unlink_activities — anyone in the org may link (not
-- owner-only): linking two already-recorded activities together doesn't
-- move money or change a definition, the same reasoning record_activity
-- itself is not owner-gated while issue_document is.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.link_activities(
  p_link_type_id     uuid,
  p_from_activity_id uuid,
  p_to_activity_id   uuid
)
returns table (link_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org  uuid := (select public.current_org_id());
  v_uid  uuid := auth.uid();
  v_lt   record;
  v_id   uuid;
begin
  if v_org is null then
    raise exception 'link_activities: no organisation for this account' using errcode = '28000';
  end if;
  if p_from_activity_id = p_to_activity_id then
    raise exception 'link_activities: an activity cannot link to itself' using errcode = '23514';
  end if;

  select * into v_lt from public.activity_link_types lt
   where lt.id = p_link_type_id and lt.org_id = v_org and lt.archived_at is null;
  if v_lt is null then
    raise exception 'link_activities: link type not found in your organisation' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.activities a
     where a.id = p_from_activity_id and a.org_id = v_org and a.activity_type_id = v_lt.from_activity_type_id
  ) then
    raise exception 'link_activities: the "from" activity does not match this link type''s expected type' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.activities a
     where a.id = p_to_activity_id and a.org_id = v_org and a.activity_type_id = v_lt.to_activity_type_id
  ) then
    raise exception 'link_activities: the "to" activity does not match this link type''s expected type' using errcode = '23514';
  end if;

  insert into public.activity_links (org_id, link_type_id, from_activity_id, to_activity_id, created_by)
  values (v_org, p_link_type_id, p_from_activity_id, p_to_activity_id, v_uid)
  on conflict (link_type_id, from_activity_id, to_activity_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.activity_links
     where link_type_id = p_link_type_id and from_activity_id = p_from_activity_id and to_activity_id = p_to_activity_id;
  else
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
    values (v_org, v_uid, 'activity.linked', 'activity_link', v_id,
            jsonb_build_object('link_type_id', p_link_type_id, 'from_activity_id', p_from_activity_id, 'to_activity_id', p_to_activity_id));
  end if;

  return query select v_id;
end;
$$;

revoke execute on function public.link_activities(uuid, uuid, uuid) from public;
grant  execute on function public.link_activities(uuid, uuid, uuid) to authenticated;

create or replace function public.unlink_activities(
  p_link_id uuid
)
returns table (link_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_uid uuid := auth.uid();
begin
  if v_org is null then
    raise exception 'unlink_activities: no organisation for this account' using errcode = '28000';
  end if;
  if not exists (select 1 from public.activity_links where id = p_link_id and org_id = v_org) then
    raise exception 'unlink_activities: link not found in your organisation' using errcode = 'P0002';
  end if;

  delete from public.activity_links where id = p_link_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id)
  values (v_org, v_uid, 'activity.unlinked', 'activity_link', p_link_id);

  return query select p_link_id;
end;
$$;

revoke execute on function public.unlink_activities(uuid) from public;
grant  execute on function public.unlink_activities(uuid) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.unlink_activities(uuid);
-- drop function if exists public.link_activities(uuid, uuid, uuid);
-- drop function if exists public.archive_activity_link_type(uuid);
-- drop function if exists public.add_activity_link_type(uuid, uuid, text, text, text);
-- drop table if exists public.activity_links;
-- drop table if exists public.activity_link_types;
