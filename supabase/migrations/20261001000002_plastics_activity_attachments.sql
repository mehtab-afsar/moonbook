-- Proof of purchase/delivery for the plastics ledger — the same feature the
-- shared engine and logistics already have (20260922000003, 20260928000001).
-- plastics_activities.attachment_path already exists (it was on the table
-- from day one, in 20260924000001_plastics_vertical_schema.sql) — only the
-- pointer-setting RPC was missing. Reuses the same storage bucket as every
-- other vertical: objects are stored at `{org_id}/{activity_id}/{filename}`,
-- and an activity id is a UUID unique across every table, so a
-- shared/logistics/plastics activity can never collide on the same path.

create or replace function public.set_plastics_activity_attachment(
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
    raise exception 'set_plastics_activity_attachment: no organisation for this account' using errcode = '28000';
  end if;
  if not exists (select 1 from public.plastics_activities where id = p_activity_id and org_id = v_org) then
    raise exception 'set_plastics_activity_attachment: activity not found in your organisation' using errcode = 'P0002';
  end if;
  if p_attachment_path is not null
     and p_attachment_path !~ ('^' || v_org::text || '/' || p_activity_id::text || '/') then
    raise exception 'set_plastics_activity_attachment: path does not belong to this activity' using errcode = '22023';
  end if;

  update public.plastics_activities set attachment_path = p_attachment_path where id = p_activity_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'plastics_activity.attachment_set', 'plastics_activity', p_activity_id,
          jsonb_build_object('attachment_path', p_attachment_path));

  return query select p_activity_id;
end;
$$;

comment on function public.set_plastics_activity_attachment(uuid, text) is
  'Records where an already-uploaded proof-of-purchase file landed for a plastics activity. Does not touch storage itself.';

revoke execute on function public.set_plastics_activity_attachment(uuid, text) from public;
grant  execute on function public.set_plastics_activity_attachment(uuid, text) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.set_plastics_activity_attachment(uuid, text);
