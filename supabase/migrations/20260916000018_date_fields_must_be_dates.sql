-- ═══════════════════════════════════════════════════════════════════════════
-- 0018 — a date field must contain a date
--
-- Supersedes validate_activity_details from
-- 20260916000010_activity_validation.sql, body carried forward whole.
--
-- The trigger checked `jsonb_typeof` against `field_type`, which for a date
-- means "is it a string" — and every string is. So 'the twelfth' was accepted
-- into a date field and stayed there, unsortable and unfilterable, printing
-- verbatim on the invoice.
--
-- The zod schema in lib/activities/details-schema.ts has always required ISO,
-- so no request through the API could do this. That is precisely why it went
-- unnoticed, and precisely why it matters: the trigger exists for the write
-- paths that bypass the API — a CSV import, a support engineer with psql —
-- which the plan describes as the ones that "land bad data 10,000 rows at a
-- time". A backstop that agrees with the front stop only on the easy cases is
-- not a backstop.
--
-- Found by calling record_activity directly rather than through the route.
--
-- Rollback: re-apply validate_activity_details from 20260916000010.
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

    -- A date has to BE a date, not merely a string.
    --
    -- Until 0018 this checked only jsonb_typeof, so 'the twelfth' was accepted
    -- into a date field and sat there: unsortable, unfilterable, and printed
    -- verbatim on an invoice. The plan's own reason for making period_start
    -- and period_end real spine columns was "an unindexable JSONB parse where
    -- a date typo sorts wrong" — the same hazard, one layer down.
    --
    -- lib/activities/details-schema.ts has always required ISO here, so the
    -- API path was never exposed. The trigger is for the paths that bypass it
    -- — a CSV import, a support engineer in the SQL console — which are
    -- exactly the ones that arrive ten thousand rows at a time. The two layers
    -- must agree, or the backstop is not one.
    if v_field.field_type = 'date' then
      if (v_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'validate_activity_details: % must be a date as YYYY-MM-DD, got "%"',
              v_field.label, v_value #>> '{}'
          using errcode = '22023';
      end if;

      -- Shape is not validity: 2026-02-30 matches the pattern above.
      begin
        perform (v_value #>> '{}')::date;
      exception when others then
        raise exception 'validate_activity_details: % is not a real date: "%"',
              v_field.label, v_value #>> '{}'
          using errcode = '22023';
      end;
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.validate_activity_details() is
  'BEFORE INSERT OR UPDATE on activities: cheap structural validation of `details` against the activity type''s field definitions — no unknown keys, all required keys present, jsonb_typeof matching field_type, select values within their options, and since 0018 dates that are real ISO dates. Runs on every write path, including the ones that bypass the API.';

revoke execute on function public.validate_activity_details() from public;

drop trigger if exists activities_validate_details on public.activities;
create trigger activities_validate_details
  before insert or update of details, activity_type_id on public.activities
  for each row execute function public.validate_activity_details();

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- Re-apply validate_activity_details from 20260916000010_activity_validation.sql.
