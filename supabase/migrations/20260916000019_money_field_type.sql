-- ═══════════════════════════════════════════════════════════════════════════
-- 0019 — a `money` field type, because `number` could not say what it meant
--
-- THE BUG. quantity_rate pricing reads its rate from a details field and took
-- that number as MINOR units. A scrap yard configuring "Rate per kg" as a
-- `number` and entering 22 — meaning 22 rupees — was billed as though it meant
-- 22 paise. 1,840 kg came to 404.80 instead of 40,480.
--
-- A hundredfold error, on every invoice, with nothing to notice it by: no
-- exception, no warning, just a smaller number than it should have been. It
-- survived this long because both shipped templates priced manually, so the
-- path never carried a real rate until the industry templates in 0020.
--
-- WHY A SEVENTH FIELD TYPE, when the plan argued for six. Because `number`
-- genuinely cannot carry this meaning. 22 is 22; whether that is rupees or
-- paise is a fact about the FIELD, not about the value, and the only places to
-- record it are the type or a comment. A comment does not stop anyone.
--
-- The value is stored in MAJOR units, as typed. Minor units would be tidier
-- internally and would print "2200" on the invoice where the reader expects
-- 22 — `printable_details` freezes `details->>key` as text and has no currency
-- to format with. lib/pricing converts once, using the organisation's
-- currency, and REFUSES a rate field that is not `money` rather than guessing.
-- The ambiguity is not documented away; it is made unsayable.
--
-- Supersedes validate_activity_details from 0018, body carried forward whole.
--
-- Rollback: convert any `money` field back to `number`, drop 'money' from the
-- check constraint, and re-apply the function from 0018.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'activity_fields_type_chk') then
    alter table public.activity_fields drop constraint activity_fields_type_chk;
  end if;

  alter table public.activity_fields
    add constraint activity_fields_type_chk
    check (field_type in ('text', 'long_text', 'number', 'money', 'date', 'select', 'boolean'));
end $$;

comment on column public.activity_fields.field_type is
  'One of seven closed types. `money` holds an amount in the organisation''s major units as typed; `number` holds a plain quantity. The distinction is load-bearing — see migration 0019.';

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
    elsif v_field.field_type in ('number', 'money') and v_type <> 'number' then
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

    -- An amount, in the organisation's major units, as it was typed. Negative
    -- money is not a price — a figure that reduces a bill is a discount or a
    -- credit note, and both have their own place.
    if v_field.field_type = 'money' and (v_value #>> '{}')::numeric < 0 then
      raise exception 'validate_activity_details: % cannot be negative', v_field.label
        using errcode = '22003';
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
  'BEFORE INSERT OR UPDATE on activities: cheap structural validation of `details` against the activity type''s field definitions — no unknown keys, all required keys present, jsonb_typeof matching field_type, select values within their options, real ISO dates, and since 0019 non-negative `money` amounts. Runs on every write path, including the ones that bypass the API.';

revoke execute on function public.validate_activity_details() from public;

drop trigger if exists activities_validate_details on public.activities;
create trigger activities_validate_details
  before insert or update of details, activity_type_id on public.activities
  for each row execute function public.validate_activity_details();
