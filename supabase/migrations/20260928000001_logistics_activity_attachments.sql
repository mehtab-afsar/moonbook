-- Proof of delivery for the logistics ledger — the same feature the shared
-- engine already has (20260922000003_activity_attachments.sql), ported to
-- logistics_activities. Reuses the same storage bucket: objects are stored
-- at `{org_id}/{activity_id}/{filename}`, and an activity id is a UUID
-- unique across every table, so a shared/logistics/plastics activity can
-- never collide on the same path.

alter table public.logistics_activities
  add column if not exists attachment_path text;

comment on column public.logistics_activities.attachment_path is
  'Path within the activity-attachments storage bucket, org_id/activity_id/filename. Set via set_logistics_activity_attachment(), never written directly.';

create or replace function public.set_logistics_activity_attachment(
  p_activity_id uuid,
  p_attachment_path text
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
begin
  if v_org is null then
    raise exception 'set_logistics_activity_attachment: no organisation for this account' using errcode = '28000';
  end if;
  if not exists (select 1 from public.logistics_activities where id = p_activity_id and org_id = v_org) then
    raise exception 'set_logistics_activity_attachment: activity not found in your organisation' using errcode = 'P0002';
  end if;
  if p_attachment_path is not null
     and p_attachment_path !~ ('^' || v_org::text || '/' || p_activity_id::text || '/') then
    raise exception 'set_logistics_activity_attachment: path does not belong to this activity' using errcode = '22023';
  end if;

  update public.logistics_activities set attachment_path = p_attachment_path where id = p_activity_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'logistics_activity.attachment_set', 'logistics_activity', p_activity_id,
          jsonb_build_object('attachment_path', p_attachment_path));

  return query select p_activity_id;
end;
$$;

comment on function public.set_logistics_activity_attachment(uuid, text) is
  'Records where an already-uploaded proof-of-delivery file landed for a logistics activity. Does not touch storage itself.';

revoke execute on function public.set_logistics_activity_attachment(uuid, text) from public;
grant  execute on function public.set_logistics_activity_attachment(uuid, text) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.set_logistics_activity_attachment(uuid, text);
-- alter table public.logistics_activities drop column if exists attachment_path;
