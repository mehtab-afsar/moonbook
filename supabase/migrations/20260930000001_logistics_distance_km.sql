-- How far a service actually travelled — nullable, since a warehousing or
-- detention charge has no distance at all, only a trip does.
--
-- This also carries the assigned_vendor_id parameter from
-- 20260927000001_logistics_service_vendor_ref.sql's column-only migration —
-- neither p_assigned_vendor_id nor p_distance_km had shipped anywhere yet,
-- so record_logistics_activity goes straight from the original 13-argument
-- version to its final 15-argument one here, in one step, rather than
-- through a 14-argument version that would exist for three days and then
-- immediately be replaced.

alter table public.logistics_activities
  add column if not exists distance_km numeric(9,1)
  constraint logistics_activities_distance_chk check (distance_km is null or distance_km >= 0);

-- `create or replace` only replaces a function whose argument TYPES match
-- exactly — adding trailing parameters changes the signature, which would
-- leave the original 13-argument version installed alongside this one
-- rather than replacing it. Dropping it first is what actually replaces it.
drop function if exists public.record_logistics_activity(
  text, uuid, date, bigint, uuid, text, text, text, text, text, text, text, bigint
);

create or replace function public.record_logistics_activity(
  p_direction          text,
  p_party_id           uuid,
  p_occurred_on        date,
  p_amount_minor       bigint,
  p_bill_to_party_id   uuid default null,
  p_origin             text default null,
  p_destination        text default null,
  p_vehicle_no         text default null,
  p_load_type          text default null,
  p_vendor_ref         text default null,
  p_reference          text default null,
  p_notes              text default null,
  p_direct_cost_minor  bigint default null,
  p_assigned_vendor_id uuid default null,
  p_distance_km        numeric default null
)
returns table (activity_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_org is null then
    raise exception 'record_logistics_activity: no organisation for this account' using errcode = '28000';
  end if;
  if p_direction not in ('receivable', 'payable') then
    raise exception 'record_logistics_activity: direction must be receivable or payable' using errcode = '22023';
  end if;
  if not exists (select 1 from public.parties where id = p_party_id and org_id = v_org) then
    raise exception 'record_logistics_activity: party not found in your organisation' using errcode = 'P0002';
  end if;
  if p_bill_to_party_id is not null
     and not exists (select 1 from public.parties where id = p_bill_to_party_id and org_id = v_org) then
    raise exception 'record_logistics_activity: bill-to party not found in your organisation' using errcode = 'P0002';
  end if;
  if p_assigned_vendor_id is not null
     and not exists (select 1 from public.parties where id = p_assigned_vendor_id and org_id = v_org) then
    raise exception 'record_logistics_activity: assigned vendor not found in your organisation' using errcode = 'P0002';
  end if;
  if p_amount_minor < 0 then
    raise exception 'record_logistics_activity: amount cannot be negative' using errcode = '22003';
  end if;
  if p_distance_km is not null and p_distance_km < 0 then
    raise exception 'record_logistics_activity: distance cannot be negative' using errcode = '22003';
  end if;

  insert into public.logistics_activities (
    org_id, party_id, bill_to_party_id, direction, occurred_on, currency, amount_minor,
    direct_cost_minor, origin, destination, vehicle_no, load_type, vendor_ref,
    reference, notes, status, created_by, assigned_vendor_id, distance_km
  )
  select v_org, p_party_id, p_bill_to_party_id, p_direction, p_occurred_on, o.base_currency, p_amount_minor,
         p_direct_cost_minor, p_origin, p_destination, p_vehicle_no, p_load_type, p_vendor_ref,
         nullif(p_reference, ''), nullif(p_notes, ''), 'completed', v_uid, p_assigned_vendor_id, p_distance_km
    from public.organisations o where o.id = v_org
  returning id into v_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'logistics_activity.recorded', 'logistics_activity', v_id,
          jsonb_build_object('direction', p_direction, 'amount_minor', p_amount_minor));

  return query select v_id;
end;
$$;

revoke execute on function public.record_logistics_activity(
  text, uuid, date, bigint, uuid, text, text, text, text, text, text, text, bigint, uuid, numeric
) from public;
grant execute on function public.record_logistics_activity(
  text, uuid, date, bigint, uuid, text, text, text, text, text, text, text, bigint, uuid, numeric
) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- alter table public.logistics_activities drop constraint if exists logistics_activities_distance_chk;
-- alter table public.logistics_activities drop column if exists distance_km;
