-- ═══════════════════════════════════════════════════════════════════════════
-- gstn_connections — which GSP (GST Suvidha Provider) an organisation has
-- connected, and how far that connection has gotten. NOT a working
-- integration: Moonbook has no GSP account of its own yet, so this table has
-- nowhere to call. It exists so the UI and the eventual client code have
-- somewhere real to read from the moment a GSP relationship exists, instead
-- of that being a schema change bolted on later.
--
-- Deliberately holds NO credentials. A client_id/client_secret belongs in a
-- proper secrets manager (or environment variables, at minimum), never in an
-- application table readable through the normal Postgres/RLS path — auth
-- material for moving tax documents on a customer's behalf is exactly the
-- kind of thing a schema leak or a bad RLS policy must never be able to
-- expose. When real API wiring happens, the CREDENTIALS live outside this
-- table; this table only ever holds which provider, which environment, and
-- what status that connection is in.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.gstn_connections (
  org_id       uuid primary key references public.organisations(id) on delete cascade,
  provider     text not null
               constraint gstn_connections_provider_chk
               check (provider in ('cleartax', 'cygnet', 'mastergst', 'iris', 'other')),
  environment  text not null default 'sandbox'
               constraint gstn_connections_environment_chk
               check (environment in ('sandbox', 'production')),
  gstin        text not null,
  status       text not null default 'not_connected'
               constraint gstn_connections_status_chk
               check (status in ('not_connected', 'pending', 'connected', 'error')),
  status_note  text,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.gstn_connections is
  'Which GSP this organisation intends to connect through, and the state of that connection — never credentials. See this migration''s own header for why.';
comment on column public.gstn_connections.status is
  'not_connected: nothing saved. pending: provider/environment saved, no working API call has ever been made — true for every row until real GSP credentials exist anywhere in this codebase. connected/error: reserved for when a real integration exists to set them.';

drop trigger if exists gstn_connections_updated_at on public.gstn_connections;
create trigger gstn_connections_updated_at before update on public.gstn_connections
  for each row execute function public.set_updated_at();

alter table public.gstn_connections enable row level security;

drop policy if exists "gstn_connections_select" on public.gstn_connections;
create policy "gstn_connections_select" on public.gstn_connections
  for select to authenticated
  using (org_id = (select public.current_org_id()));

revoke all on public.gstn_connections from anon;
grant select on public.gstn_connections to authenticated;
grant select, insert, update, delete on public.gstn_connections to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- set_gstn_connection: owner-only upsert. No "connect" call to any GSP
-- happens here — see the table's own comment. Saving is just recording
-- intent, exactly like recording an e-way bill number by hand elsewhere in
-- this migration series (20261001000007).
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.set_gstn_connection(
  p_provider    text,
  p_environment text,
  p_gstin       text
)
-- NOT named `org_id`: `returns table` implicitly declares its column names
-- as plpgsql variables for the whole function body, and this function's own
-- INSERT statements reference an `org_id` COLUMN throughout — the exact
-- collision that broke set_org_logo earlier in this project (see
-- 20260930000002_org_logo.sql's own history). Renaming the OUT column here
-- removes the collision outright, rather than requiring every reference in
-- the body to be table-aliased and audited by hand.
returns table (out_org_id uuid)
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
    raise exception 'set_gstn_connection: no organisation for this account' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.org_id = v_org and p.role = 'owner') then
    raise exception 'set_gstn_connection: only an owner can change this' using errcode = '42501';
  end if;
  if p_provider not in ('cleartax', 'cygnet', 'mastergst', 'iris', 'other') then
    raise exception 'set_gstn_connection: unknown provider %', p_provider using errcode = '22023';
  end if;
  if p_environment not in ('sandbox', 'production') then
    raise exception 'set_gstn_connection: environment must be sandbox or production' using errcode = '22023';
  end if;
  if nullif(trim(p_gstin), '') is null then
    raise exception 'set_gstn_connection: a GSTIN is required' using errcode = '22004';
  end if;

  insert into public.gstn_connections (org_id, provider, environment, gstin, status, status_note, created_by)
  values (v_org, p_provider, p_environment, upper(trim(p_gstin)), 'pending',
          'Recorded here; no API credentials exist yet, so no call to this provider has been made.', v_uid)
  on conflict (org_id) do update set
    provider    = excluded.provider,
    environment = excluded.environment,
    gstin       = excluded.gstin,
    status      = 'pending',
    status_note = excluded.status_note;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'organisation.gstn_connection_set', 'organisation', v_org,
          jsonb_build_object('provider', p_provider, 'environment', p_environment));

  return query select v_org as out_org_id;
end;
$$;

revoke execute on function public.set_gstn_connection(text, text, text) from public;
grant  execute on function public.set_gstn_connection(text, text, text) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.set_gstn_connection(text, text, text);
-- drop table if exists public.gstn_connections;
