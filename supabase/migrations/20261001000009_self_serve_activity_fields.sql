-- ═══════════════════════════════════════════════════════════════════════════
-- Self-serve ontology editing — an owner can add, edit and archive their OWN
-- copied activity_type's fields, without a migration or a manual DB write.
--
-- Closes a real gap: apply_industry_template() deep-copies system rows into
-- an org's own activity_types/activity_fields at signup, and Settings has
-- shown that copy read-only ever since — "these are yours" was true in name
-- only, since nothing let an owner actually change them. See
-- docs/ONTOLOGY.md's "What it is not (yet)" section, which named this gap
-- explicitly before this migration closed it.
--
-- Three RPCs, not one, because a field has two kinds of attribute that
-- behave differently once activities have been recorded against it:
--
--   · IDENTITY (key, field_type) — fixes the shape of every `details` value
--     already stored under this key. Changing field_type after the fact
--     would leave old activities holding values that no longer match their
--     own field's type. Never editable — add_activity_field sets these once,
--     archive_activity_field retires them; there is no "change the type."
--   · PRESENTATION (label, options, is_required, is_reportable,
--     show_on_document) — how the field is asked for and shown, not what
--     shape its stored values take. Safe to edit going forward, since
--     nothing financial is computed from it (see the spine-purity guard).
--
-- Same "append-only, archived rather than deleted" rule the table's own
-- comment already states: a document issued while a field existed must
-- still be able to render the label it was captured under.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.add_activity_field(
  p_activity_type_id uuid,
  p_key              text,
  p_label            text,
  p_field_type       text,
  p_options          jsonb default '[]'::jsonb,
  p_is_required      boolean default false,
  p_is_reportable    boolean default false,
  p_show_on_document boolean default true
)
returns table (field_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org   uuid := (select public.current_org_id());
  v_uid   uuid := auth.uid();
  v_id    uuid;
  v_sort  integer;
begin
  if v_org is null then
    raise exception 'add_activity_field: no organisation for this account' using errcode = '28000';
  end if;
  if not (select public.has_role('owner')) then
    raise exception 'add_activity_field: requires the owner role' using errcode = '42501';
  end if;

  -- Must be one of THIS org's own copied types — never a system template
  -- (org_id is null there) and never another org's, which RLS would already
  -- hide but this gives a clear error instead of a confusing "not found."
  if not exists (
    select 1 from public.activity_types t where t.id = p_activity_type_id and t.org_id = v_org
  ) then
    raise exception 'add_activity_field: activity type not found in your organisation' using errcode = 'P0002';
  end if;

  if p_key !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'add_activity_field: key must be lowercase, start with a letter, and use only letters, numbers and underscores' using errcode = '22023';
  end if;
  if p_field_type not in ('text', 'long_text', 'number', 'money', 'date', 'select', 'boolean') then
    raise exception 'add_activity_field: unknown field type %', p_field_type using errcode = '22023';
  end if;
  if p_field_type = 'select' and jsonb_array_length(coalesce(p_options, '[]'::jsonb)) = 0 then
    raise exception 'add_activity_field: a select field needs at least one option' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.activity_fields f
     where f.activity_type_id = p_activity_type_id and f.key = p_key and f.archived_at is null
  ) then
    raise exception 'add_activity_field: a field with that key already exists on this type' using errcode = '23505';
  end if;

  select coalesce(max(sort_order) + 1, 0) into v_sort
    from public.activity_fields where activity_type_id = p_activity_type_id;

  insert into public.activity_fields (
    activity_type_id, org_id, key, label, field_type, options,
    is_required, is_reportable, show_on_document, sort_order
  ) values (
    p_activity_type_id, v_org, p_key, p_label, p_field_type, coalesce(p_options, '[]'::jsonb),
    p_is_required, p_is_reportable, p_show_on_document, v_sort
  )
  returning id into v_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'activity_field.added', 'activity_field', v_id,
          jsonb_build_object('activity_type_id', p_activity_type_id, 'key', p_key, 'field_type', p_field_type));

  return query select v_id;
end;
$$;

revoke execute on function public.add_activity_field(uuid, text, text, text, jsonb, boolean, boolean, boolean) from public;
grant  execute on function public.add_activity_field(uuid, text, text, text, jsonb, boolean, boolean, boolean) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- update_activity_field: PRESENTATION attributes only — see the file header.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.update_activity_field(
  p_field_id         uuid,
  p_label            text,
  p_options          jsonb default '[]'::jsonb,
  p_is_required      boolean default false,
  p_is_reportable    boolean default false,
  p_show_on_document boolean default true
)
returns table (field_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org       uuid := (select public.current_org_id());
  v_uid       uuid := auth.uid();
  v_before    jsonb;
  v_type      text;
begin
  if v_org is null then
    raise exception 'update_activity_field: no organisation for this account' using errcode = '28000';
  end if;
  if not (select public.has_role('owner')) then
    raise exception 'update_activity_field: requires the owner role' using errcode = '42501';
  end if;

  select to_jsonb(f), f.field_type into v_before, v_type
    from public.activity_fields f
   where f.id = p_field_id and f.org_id = v_org and f.archived_at is null
   for update;

  if v_before is null then
    raise exception 'update_activity_field: field not found in your organisation' using errcode = 'P0002';
  end if;
  if v_type = 'select' and jsonb_array_length(coalesce(p_options, '[]'::jsonb)) = 0 then
    raise exception 'update_activity_field: a select field needs at least one option' using errcode = '22023';
  end if;

  update public.activity_fields set
    label            = p_label,
    options          = coalesce(p_options, '[]'::jsonb),
    is_required      = p_is_required,
    is_reportable    = p_is_reportable,
    show_on_document = p_show_on_document
  where id = p_field_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, before, after)
  select v_org, v_uid, 'activity_field.updated', 'activity_field', p_field_id, v_before, to_jsonb(f)
    from public.activity_fields f where f.id = p_field_id;

  return query select p_field_id;
end;
$$;

revoke execute on function public.update_activity_field(uuid, text, jsonb, boolean, boolean, boolean) from public;
grant  execute on function public.update_activity_field(uuid, text, jsonb, boolean, boolean, boolean) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- archive_activity_field: soft delete, same reasoning as activity_types'
-- own archived_at — a document issued while this field existed must still
-- render the label it was captured under.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.archive_activity_field(
  p_field_id uuid
)
returns table (field_id uuid)
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
    raise exception 'archive_activity_field: no organisation for this account' using errcode = '28000';
  end if;
  if not (select public.has_role('owner')) then
    raise exception 'archive_activity_field: requires the owner role' using errcode = '42501';
  end if;

  select to_jsonb(f) into v_before
    from public.activity_fields f
   where f.id = p_field_id and f.org_id = v_org and f.archived_at is null
   for update;

  if v_before is null then
    raise exception 'archive_activity_field: field not found in your organisation, or already archived' using errcode = 'P0002';
  end if;

  update public.activity_fields set archived_at = now() where id = p_field_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, before)
  values (v_org, v_uid, 'activity_field.archived', 'activity_field', p_field_id, v_before);

  return query select p_field_id;
end;
$$;

revoke execute on function public.archive_activity_field(uuid) from public;
grant  execute on function public.archive_activity_field(uuid) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.archive_activity_field(uuid);
-- drop function if exists public.update_activity_field(uuid, text, jsonb, boolean, boolean, boolean);
-- drop function if exists public.add_activity_field(uuid, text, text, text, jsonb, boolean, boolean, boolean);
