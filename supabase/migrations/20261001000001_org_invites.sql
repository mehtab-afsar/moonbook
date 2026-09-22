-- ═══════════════════════════════════════════════════════════════════════════
-- Team invites — a second person joining an existing organisation.
--
-- organisations is already the workspace (tenant root, one row per business);
-- profiles already maps one auth user to exactly one org and one role. What
-- was missing is the one mechanism to get a SECOND person into that same
-- org, rather than every sign-up spinning up its own — this migration is
-- that mechanism, and nothing else. It is a direct, intentionally
-- unmodified port of the pattern already running in LogiFlow
-- (org_invites + accept_org_invite()), because the shape — organisations /
-- profiles(role) / auth.users — is the same across every sibling app in
-- this family. Porting it to another one should mean copying this file and
-- changing nothing but the schema/table prefix, if even that.
--
-- The trust boundary is deliberately "you signed in as the email the invite
-- named," not a token in a URL: there is no invite id or secret the client
-- ever holds or could leak. Nothing here sends an email — the owner shares
-- the invited address out of band (Slack, a text, whatever), and acceptance
-- works regardless of how the invitee heard about it. An actual "send an
-- email" step is a pure enhancement on top of this, not a blocker to it.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.org_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations(id) on delete cascade,
  email       text not null
              constraint org_invites_email_chk check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role        text not null default 'staff'
              constraint org_invites_role_chk check (role in ('owner', 'staff')),
  invited_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz
);

-- One live (unaccepted, unexpired doesn't matter here — see below) pending
-- invite per email per org at a time, so re-inviting someone replaces
-- rather than piles up. Partial: an accepted invite is history, not a slot.
create unique index if not exists org_invites_pending_uniq
  on public.org_invites (org_id, email) where accepted_at is null;

create index if not exists org_invites_email_idx on public.org_invites (email) where accepted_at is null;

comment on table public.org_invites is
  'A pending seat in an organisation. Accepted only via accept_org_invite() — see that function''s comment for why there is no client-facing UPDATE.';

alter table public.org_invites enable row level security;

drop policy if exists "org_invites_select" on public.org_invites;
create policy "org_invites_select" on public.org_invites
  for select to authenticated using (org_id = (select public.current_org_id()));

drop policy if exists "org_invites_insert" on public.org_invites;
create policy "org_invites_insert" on public.org_invites
  for insert to authenticated
  with check (
    org_id = (select public.current_org_id())
    and (select public.has_role('owner'))
    and invited_by = (select auth.uid())
  );

-- No UPDATE policy for any client role: acceptance (which sets accepted_at
-- and, more importantly, creates the accepting profile) is the one thing
-- only accept_org_invite() may do — a direct client UPDATE could set
-- accepted_at without ever creating the profile, or accept someone else's
-- invite outright. Revocation is a DELETE, via cancel_org_invite() below,
-- for the same reason: an owner should be able to withdraw an invite, but
-- only through a path that can also be audited.

revoke all on public.org_invites from anon;
grant select, insert on public.org_invites to authenticated;
grant select, insert, update, delete on public.org_invites to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- accept_org_invite() — try to join an existing org as the caller's own
-- verified email.
--
-- Zero arguments, deliberately: nothing from the client decides which
-- invite gets accepted, only auth.uid() and that user's own auth.users.email
-- do. Called speculatively right after sign-in, before falling back to
-- "no profile yet → create your own org" — see postSignInDestination().
-- A no-op (empty result, no error) whenever there is nothing to accept:
-- already has a profile, no invite for this email, or the invite expired.
-- That makes it safe to call unconditionally rather than needing the
-- caller to first check whether an invite exists.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.accept_org_invite()
returns table (org_id uuid, role text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_invite record;
begin
  if v_uid is null then
    raise exception 'accept_org_invite: no authenticated user' using errcode = '28000';
  end if;

  -- One org per user, already the rule create_organisation() enforces —
  -- a returning user with a profile has nothing to accept.
  if exists (select 1 from public.profiles where id = v_uid) then
    return;
  end if;

  select lower(trim(au.email)) into v_email from auth.users au where au.id = v_uid;
  if v_email is null then
    return;
  end if;

  -- Locked, so two near-simultaneous calls (a double page load, a retried
  -- request) can't both pass the "not yet accepted" check and both try to
  -- insert a profile for the same user.
  select * into v_invite
    from public.org_invites
    where email = v_email and accepted_at is null and expires_at > now()
    order by created_at desc
    limit 1
    for update;

  if not found then
    return;
  end if;

  insert into public.profiles (id, org_id, full_name, role)
  values (
    v_uid, v_invite.org_id,
    (select au.raw_user_meta_data ->> 'full_name' from auth.users au where au.id = v_uid),
    v_invite.role
  );

  update public.org_invites set accepted_at = now() where id = v_invite.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_invite.org_id, v_uid, 'org_invite.accepted', 'org_invite', v_invite.id,
          jsonb_build_object('email', v_email, 'role', v_invite.role));

  return query select v_invite.org_id, v_invite.role;
end;
$$;

comment on function public.accept_org_invite() is
  'Joins the caller to whichever org invited their own auth email, if any. No-op, not an error, when there is nothing to accept.';

revoke execute on function public.accept_org_invite() from public;
grant  execute on function public.accept_org_invite() to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- cancel_org_invite() — an owner withdrawing a pending invite.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.cancel_org_invite(
  p_invite_id uuid
)
returns table (invite_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_uid uuid := auth.uid();
begin
  if v_org is null or not (select public.has_role('owner')) then
    raise exception 'cancel_org_invite: only an owner can withdraw an invite' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.org_invites
    where id = p_invite_id and org_id = v_org and accepted_at is null
  ) then
    raise exception 'cancel_org_invite: invite not found' using errcode = 'P0002';
  end if;

  delete from public.org_invites where id = p_invite_id and org_id = v_org;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id)
  values (v_org, v_uid, 'org_invite.cancelled', 'org_invite', p_invite_id);

  return query select p_invite_id;
end;
$$;

comment on function public.cancel_org_invite(uuid) is
  'Withdraws a pending invite. Owner-only; an already-accepted invite cannot be cancelled (it is history, not a slot).';

revoke execute on function public.cancel_org_invite(uuid) from public;
grant  execute on function public.cancel_org_invite(uuid) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.cancel_org_invite(uuid);
-- drop function if exists public.accept_org_invite();
-- drop table if exists public.org_invites;
