-- ═══════════════════════════════════════════════════════════════════════════
-- 0015 — update_activity: correcting work that was recorded wrongly
--
-- The build plan specified that writes to `activities` go through
-- `record_activity()` AND `update_activity()`. Only the first was ever
-- written, and `activities` grants clients SELECT alone, so until now a
-- recorded activity was permanent. A trip entered as 38,000 when it was 3,800
-- could not be edited, voided or removed through the product — it stayed in
-- the list, billable, wrong, and the only remedy was a SQL console.
--
-- For a billing product that is the gap that matters: businesses mistype
-- amounts every day.
--
-- FULL REPLACEMENT, NOT A PATCH. Every column is passed on every call, the
-- same arguments record_activity takes. A partial update would have to use
-- NULL to mean "leave alone", which then makes it impossible to CLEAR a
-- nullable field — you could add a reference but never remove one. The UI
-- loads the row, shows it filled in, and submits the whole thing.
--
-- `details` is replaced wholesale for the same reason, and revalidated by the
-- existing BEFORE UPDATE trigger, so a correction cannot introduce a value
-- that a fresh record would have rejected.
--
-- WHAT IT REFUSES. An activity that has been invoiced. Editing billed work
-- would silently change what an invoice was raised for while the invoice's own
-- frozen snapshot says otherwise — the document and the ledger would disagree
-- and nothing would report it. The remedy there is to cancel the document
-- (which frees the work) or raise a credit note; both leave a trail.
--
-- The activity TYPE is deliberately not a parameter. Changing it would leave
-- `details` validated against a different field schema, and `direction`
-- pinned by a composite foreign key to the old type. Recording the work again
-- under the right type is the honest correction.
--
-- Rollback: drop function public.update_activity(...);
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.update_activity(
  p_activity_id      uuid,
  p_party_id         uuid,
  p_occurred_on      date,
  p_amount_minor     bigint,
  p_bill_to_party_id uuid default null,
  p_reference        text default null,
  p_details          jsonb default '{}'::jsonb,
  p_direct_cost_minor bigint default null,
  p_period_start     date default null,
  p_period_end       date default null,
  p_notes            text default null,
  p_status           text default 'completed'
)
returns table (activity_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org      uuid := (select public.current_org_id());
  v_uid      uuid := auth.uid();
  v_before   jsonb;
  v_status   text;
  v_type_id  uuid;
  v_dim1_key text;
begin
  if v_org is null then
    raise exception 'update_activity: no organisation for this account' using errcode = '28000';
  end if;

  -- Locked for the rest of the transaction: without it, a correction and an
  -- attempt to bill the same work can interleave, and the invoice is raised
  -- against the amount that was true a moment ago.
  select to_jsonb(a), a.status, a.activity_type_id
    into v_before, v_status, v_type_id
    from public.activities a
   where a.id = p_activity_id and a.org_id = v_org
     for update;

  if v_before is null then
    raise exception 'update_activity: activity not found in your organisation' using errcode = 'P0002';
  end if;

  if v_status = 'invoiced' then
    raise exception 'update_activity: this work has already been invoiced — cancel the document or raise a credit note instead'
      using errcode = '23514';
  end if;

  if not exists (select 1 from public.parties where id = p_party_id and org_id = v_org) then
    raise exception 'update_activity: party not found in your organisation' using errcode = 'P0002';
  end if;
  if p_bill_to_party_id is not null
     and not exists (select 1 from public.parties where id = p_bill_to_party_id and org_id = v_org) then
    raise exception 'update_activity: bill-to party not found in your organisation' using errcode = 'P0002';
  end if;

  if p_amount_minor < 0 then
    raise exception 'update_activity: amount cannot be negative' using errcode = '22003';
  end if;

  -- 'invoiced' is set by issue_document alone. Letting a caller assert it
  -- would mark work as billed with no document behind it.
  if p_status not in ('pending', 'completed', 'cancelled') then
    raise exception 'update_activity: status must be pending, completed or cancelled' using errcode = '22023';
  end if;

  -- The reportable field is re-derived from the new details, under the key
  -- the type currently nominates — the same mirroring record_activity does.
  select t.dim1_field_key into v_dim1_key
    from public.activity_types t where t.id = v_type_id;

  update public.activities a
     set party_id          = p_party_id,
         bill_to_party_id  = p_bill_to_party_id,
         occurred_on       = p_occurred_on,
         period_start      = p_period_start,
         period_end        = p_period_end,
         amount_minor      = p_amount_minor,
         direct_cost_minor = p_direct_cost_minor,
         reference         = nullif(p_reference, ''),
         status            = p_status,
         dim1_key          = v_dim1_key,
         dim1_value        = case when v_dim1_key is not null then p_details ->> v_dim1_key end,
         details           = coalesce(p_details, '{}'::jsonb),
         notes             = nullif(p_notes, ''),
         updated_at        = now()
   where a.id = p_activity_id;

  -- Before and after both recorded: a correction to money is exactly the kind
  -- of change someone will later need to account for.
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, before, after)
  select v_org, v_uid, 'activity.updated', 'activity', p_activity_id, v_before, to_jsonb(a)
    from public.activities a where a.id = p_activity_id;

  return query select p_activity_id;
end;
$$;

comment on function public.update_activity(uuid, uuid, date, bigint, uuid, text, jsonb, bigint, date, date, text, text) is
  'Corrects a recorded activity in full, refusing once it has been invoiced. Re-derives the reportable dimension, revalidates details through the existing trigger, and logs activity.updated with the row before and after.';

revoke execute on function public.update_activity(uuid, uuid, date, bigint, uuid, text, jsonb, bigint, date, date, text, text) from public;
grant  execute on function public.update_activity(uuid, uuid, date, bigint, uuid, text, jsonb, bigint, date, date, text, text) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.update_activity(uuid, uuid, date, bigint, uuid, text, jsonb, bigint, date, date, text, text);
