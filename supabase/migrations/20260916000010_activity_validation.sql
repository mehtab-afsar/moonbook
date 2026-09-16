-- ═══════════════════════════════════════════════════════════════════════════
-- 10 · Validating the descriptive body
--
-- `activities.details` is free-shaped jsonb, which is what makes one schema
-- serve every industry. Free-shaped is not the same as unchecked: without a
-- guard, one bad import turns a column the documents render from into
-- unreadable noise, and nothing complains until a customer sees it.
--
-- Validation lives in TWO places on purpose, and they are not redundant:
--
--   This trigger  — cheap structural rules that make corruption IMPOSSIBLE:
--                   no unknown keys, required keys present, the jsonb type
--                   matches the declared field type, select values are in
--                   the option list.
--   lib/activities/details-schema.ts — the same rules plus ranges, lengths
--                   and readable per-field messages, so the person filling
--                   the form learns WHICH box is wrong.
--
-- The trigger is not optional even though every write today goes through
-- record_activity(). The write paths that bypass an RPC are the ones not
-- written yet — a CSV import, a support engineer in the SQL console, a second
-- service — and those arrive with ten thousand rows at a time. A plain CHECK
-- constraint cannot do this: it may not reference another table.
--
-- Archived fields are ACCEPTED but never REQUIRED. A row captured last year
-- still carries the key that has since been archived, and an update to that
-- row must not be rejected for containing its own history.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.validate_activity_details()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_key   text;
  v_field record;
  v_value jsonb;
  v_type  text;
begin
  if jsonb_typeof(new.details) <> 'object' then
    raise exception 'validate_activity_details: details must be a JSON object' using errcode = '22023';
  end if;

  -- Unknown keys. Archived fields still count as known, so historical rows
  -- remain updatable.
  for v_key in select jsonb_object_keys(new.details) loop
    if not exists (
      select 1 from public.activity_fields f
       where f.activity_type_id = new.activity_type_id and f.key = v_key
    ) then
      raise exception 'validate_activity_details: "%" is not a field on this activity type', v_key
        using errcode = '22023';
    end if;
  end loop;

  for v_field in
    select f.key, f.label, f.field_type, f.is_required, f.options
      from public.activity_fields f
     where f.activity_type_id = new.activity_type_id
       and f.archived_at is null
  loop
    v_value := new.details -> v_field.key;
    v_type  := jsonb_typeof(v_value);

    -- Present-and-meaningful: absent, JSON null, and empty string are all
    -- "not filled in" as far as a required field is concerned.
    if v_field.is_required and (
         v_value is null
         or v_type = 'null'
         or (v_type = 'string' and length(trim(v_value #>> '{}')) = 0)
       ) then
      raise exception 'validate_activity_details: % is required', v_field.label
        using errcode = '22004';
    end if;

    if v_value is null or v_type = 'null' then
      continue;
    end if;

    if v_field.field_type in ('text', 'long_text', 'date') and v_type <> 'string' then
      raise exception 'validate_activity_details: % must be text, got %', v_field.label, v_type
        using errcode = '22023';
    elsif v_field.field_type = 'number' and v_type <> 'number' then
      raise exception 'validate_activity_details: % must be a number, got %', v_field.label, v_type
        using errcode = '22023';
    elsif v_field.field_type = 'boolean' and v_type <> 'boolean' then
      raise exception 'validate_activity_details: % must be true or false, got %', v_field.label, v_type
        using errcode = '22023';
    elsif v_field.field_type = 'select' then
      if v_type <> 'string' then
        raise exception 'validate_activity_details: % must be one of its options, got %', v_field.label, v_type
          using errcode = '22023';
      end if;
      if not (v_field.options ? (v_value #>> '{}')) then
        raise exception 'validate_activity_details: "%" is not an option for %', v_value #>> '{}', v_field.label
          using errcode = '22023';
      end if;
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.validate_activity_details() is
  'BEFORE INSERT OR UPDATE on activities. Structural validation of details against its type''s field definitions — the rules that must hold no matter which write path produced the row.';

revoke execute on function public.validate_activity_details() from public;

drop trigger if exists activities_validate_details on public.activities;
create trigger activities_validate_details
  before insert or update of details, activity_type_id on public.activities
  for each row execute function public.validate_activity_details();

-- ───────────────────────────────────────────────────────────────────────────
-- rebuild_dimensions: re-derive the mirrored reportable field.
--
-- Owner-only, and deliberately with no UI (see the build plan's cut list).
-- Repointing activity_types.dim1_field_key leaves existing rows carrying the
-- OLD key in dim1_key — detectable, because the key is stored beside the
-- value, rather than silently mixed. This re-derives them, and because every
-- row records which key it holds, the operation is idempotent and resumable.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.rebuild_dimensions(p_activity_type_id uuid)
returns table (rebuilt_count bigint)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org   uuid := (select public.current_org_id());
  v_uid   uuid := auth.uid();
  v_key   text;
  v_count bigint;
begin
  if v_org is null then
    raise exception 'rebuild_dimensions: no organisation for this account' using errcode = '28000';
  end if;
  if not (select public.has_role('owner')) then
    raise exception 'rebuild_dimensions: requires the owner role' using errcode = '42501';
  end if;

  select t.dim1_field_key into v_key
    from public.activity_types t
   where t.id = p_activity_type_id and t.org_id = v_org;

  if not found then
    raise exception 'rebuild_dimensions: activity type not found in your organisation' using errcode = 'P0002';
  end if;

  update public.activities a
     set dim1_key   = v_key,
         dim1_value = case when v_key is not null then a.details ->> v_key end
   where a.activity_type_id = p_activity_type_id
     and a.org_id = v_org
     and (a.dim1_key is distinct from v_key
          or a.dim1_value is distinct from (case when v_key is not null then a.details ->> v_key end));

  get diagnostics v_count = row_count;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'activity_type.dimensions_rebuilt', 'activity_type', p_activity_type_id,
          jsonb_build_object('dim1_field_key', v_key, 'rebuilt_count', v_count));

  return query select v_count;
end;
$$;

comment on function public.rebuild_dimensions(uuid) is
  'Owner-only. Re-derives dim1_key/dim1_value for every activity of a type after its reportable field changes. Idempotent: only rows that actually differ are touched.';

revoke execute on function public.rebuild_dimensions(uuid) from public;
grant  execute on function public.rebuild_dimensions(uuid) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.rebuild_dimensions(uuid);
-- drop trigger if exists activities_validate_details on public.activities;
-- drop function if exists public.validate_activity_details();
