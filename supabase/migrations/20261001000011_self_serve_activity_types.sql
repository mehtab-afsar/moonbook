-- ═══════════════════════════════════════════════════════════════════════════
-- Self-serve creation of brand-new activity types — closing the one item
-- left on docs/ONTOLOGY.md's list after fields and relationships got their
-- own self-serve RPCs (20261001000009, 20261001000010).
--
-- This needs NO schema change: activity_types already carries the owner-only
-- RLS policy (activity_types_write, from 20260916000005) that would let an
-- owner write here directly. What was actually missing was the RPC and UI —
-- the same gap fields had before 20261001000009, not a database limitation.
--
-- Same identity/presentation split as add_activity_field:
--   · IDENTITY (key, direction) — direction decides which ledger every
--     activity of this type belongs to and is load-bearing in a composite FK
--     (activity_types_id_direction_uniq, referenced by activities); changing
--     it after activities exist would let a row disagree with its own type
--     about which ledger it's in. Never editable — set once, archived not
--     changed.
--   · PRESENTATION (labels, pricing strategy/config, uses_period,
--     uses_job_margin, dim1_field_key) — computed fresh from the CURRENT row
--     every time (computeAmount, margin views), never frozen into a past
--     activity's own stored amount_minor. Safe to edit going forward.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.add_activity_type(
  p_key              text,
  p_label_singular   text,
  p_label_plural     text,
  p_direction        text,
  p_pricing_strategy text default 'manual',
  p_pricing_config   jsonb default '{}'::jsonb,
  p_uses_period      boolean default false,
  p_uses_job_margin  boolean default true
)
returns table (activity_type_id uuid)
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
    raise exception 'add_activity_type: no organisation for this account' using errcode = '28000';
  end if;
  if not (select public.has_role('owner')) then
    raise exception 'add_activity_type: requires the owner role' using errcode = '42501';
  end if;
  if p_key !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'add_activity_type: key must be lowercase, start with a letter, and use only letters, numbers and underscores' using errcode = '22023';
  end if;
  if p_direction not in ('receivable', 'payable') then
    raise exception 'add_activity_type: direction must be receivable or payable' using errcode = '22023';
  end if;
  if p_pricing_strategy not in ('manual', 'flat', 'quantity_rate') then
    raise exception 'add_activity_type: unknown pricing strategy %', p_pricing_strategy using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_pricing_config, '{}'::jsonb)) <> 'object' then
    raise exception 'add_activity_type: pricing config must be an object' using errcode = '22023';
  end if;
  if exists (select 1 from public.activity_types t where t.org_id = v_org and t.key = p_key) then
    raise exception 'add_activity_type: a type with that key already exists' using errcode = '23505';
  end if;

  select coalesce(max(sort_order) + 1, 0) into v_sort
    from public.activity_types where org_id = v_org;

  insert into public.activity_types (
    org_id, template_key, key, label_singular, label_plural, direction,
    pricing_strategy, pricing_config, uses_period, uses_job_margin, sort_order
  ) values (
    v_org, null, p_key, p_label_singular, p_label_plural, p_direction,
    p_pricing_strategy, coalesce(p_pricing_config, '{}'::jsonb), p_uses_period, p_uses_job_margin, v_sort
  )
  returning id into v_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'activity_type.added', 'activity_type', v_id,
          jsonb_build_object('key', p_key, 'direction', p_direction, 'pricing_strategy', p_pricing_strategy));

  return query select v_id;
end;
$$;

revoke execute on function public.add_activity_type(text, text, text, text, text, jsonb, boolean, boolean) from public;
grant  execute on function public.add_activity_type(text, text, text, text, text, jsonb, boolean, boolean) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- update_activity_type: PRESENTATION attributes only — see the file header.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.update_activity_type(
  p_activity_type_id uuid,
  p_label_singular   text,
  p_label_plural     text,
  p_pricing_strategy text default 'manual',
  p_pricing_config   jsonb default '{}'::jsonb,
  p_uses_period      boolean default false,
  p_uses_job_margin  boolean default true
)
returns table (activity_type_id uuid)
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
    raise exception 'update_activity_type: no organisation for this account' using errcode = '28000';
  end if;
  if not (select public.has_role('owner')) then
    raise exception 'update_activity_type: requires the owner role' using errcode = '42501';
  end if;
  if p_pricing_strategy not in ('manual', 'flat', 'quantity_rate') then
    raise exception 'update_activity_type: unknown pricing strategy %', p_pricing_strategy using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_pricing_config, '{}'::jsonb)) <> 'object' then
    raise exception 'update_activity_type: pricing config must be an object' using errcode = '22023';
  end if;

  select to_jsonb(t) into v_before
    from public.activity_types t
   where t.id = p_activity_type_id and t.org_id = v_org and t.archived_at is null
   for update;

  if v_before is null then
    raise exception 'update_activity_type: activity type not found in your organisation' using errcode = 'P0002';
  end if;

  update public.activity_types set
    label_singular   = p_label_singular,
    label_plural     = p_label_plural,
    pricing_strategy = p_pricing_strategy,
    pricing_config   = coalesce(p_pricing_config, '{}'::jsonb),
    uses_period      = p_uses_period,
    uses_job_margin  = p_uses_job_margin
  where id = p_activity_type_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, before, after)
  select v_org, v_uid, 'activity_type.updated', 'activity_type', p_activity_type_id, v_before, to_jsonb(t)
    from public.activity_types t where t.id = p_activity_type_id;

  return query select p_activity_type_id;
end;
$$;

revoke execute on function public.update_activity_type(uuid, text, text, text, jsonb, boolean, boolean) from public;
grant  execute on function public.update_activity_type(uuid, text, text, text, jsonb, boolean, boolean) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- archive_activity_type: soft delete, same reasoning as archive_activity_field
-- — an already-issued document's frozen snapshot references its type's label
-- as it stood at issue time, but the ledger's own historical rows
-- (activities, document_lines) still carry activity_type_id and must keep
-- resolving to a real row, not a deleted one.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.archive_activity_type(
  p_activity_type_id uuid
)
returns table (activity_type_id uuid)
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
    raise exception 'archive_activity_type: no organisation for this account' using errcode = '28000';
  end if;
  if not (select public.has_role('owner')) then
    raise exception 'archive_activity_type: requires the owner role' using errcode = '42501';
  end if;

  select to_jsonb(t) into v_before
    from public.activity_types t
   where t.id = p_activity_type_id and t.org_id = v_org and t.archived_at is null
   for update;

  if v_before is null then
    raise exception 'archive_activity_type: activity type not found in your organisation, or already archived' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.activities a where a.activity_type_id = p_activity_type_id and a.status <> 'cancelled') then
    raise exception 'archive_activity_type: this type still has active work recorded against it — cancel or bill it first' using errcode = '23514';
  end if;

  update public.activity_types set archived_at = now() where id = p_activity_type_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, before)
  values (v_org, v_uid, 'activity_type.archived', 'activity_type', p_activity_type_id, v_before);

  return query select p_activity_type_id;
end;
$$;

revoke execute on function public.archive_activity_type(uuid) from public;
grant  execute on function public.archive_activity_type(uuid) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.archive_activity_type(uuid);
-- drop function if exists public.update_activity_type(uuid, text, text, text, jsonb, boolean, boolean);
-- drop function if exists public.add_activity_type(text, text, text, text, text, jsonb, boolean, boolean);
