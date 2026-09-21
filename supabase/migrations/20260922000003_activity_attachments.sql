-- ═══════════════════════════════════════════════════════════════════════════
-- 25 · Proof of delivery: one file per activity
--
-- A weighbridge slip photo, a signed POD, a delivery note — supporting
-- evidence for a specific piece of work. Nothing before this let a business
-- attach one; documents/payments carry attachment-style columns
-- (pdf_path/attachment_path) but activities never did.
--
-- Attaching a file has nothing to do with pricing, billing status or any
-- other invariant record_activity/update_activity enforce, so it is its own
-- narrow RPC rather than a parameter bolted onto either of those — the same
-- reasoning that kept parties' contact fields out of the billing RPCs.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.activities
  add column if not exists attachment_path text;

comment on column public.activities.attachment_path is
  'Path within the activity-attachments storage bucket, org_id/activity_id/filename. Set via set_activity_attachment(), never written directly.';

-- ───────────────────────────────────────────────────────────────────────────
-- The bucket. Private: every read goes through a signed URL minted after an
-- RLS-checked lookup of the activity, the same tenancy boundary as
-- everything else here — never a public bucket URL.
-- ───────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'activity-attachments', 'activity-attachments', false,
  10485760, -- 10 MB — a phone photo or a scanned slip, not a video
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Objects are stored at `{org_id}/{activity_id}/{filename}` — the first path
-- segment is what these policies check, mirroring current_org_id() without
-- needing a join, because storage.objects carries no org_id column of its
-- own to join against.
drop policy if exists "activity_attachments_select" on storage.objects;
create policy "activity_attachments_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'activity-attachments'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
  );

drop policy if exists "activity_attachments_insert" on storage.objects;
create policy "activity_attachments_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'activity-attachments'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
  );

-- ───────────────────────────────────────────────────────────────────────────
-- set_activity_attachment: point an activity at an already-uploaded object.
--
-- Upload happens first (the API route writes to storage, itself RLS-checked
-- by the policies above), and this RPC only records where it landed — it
-- never touches storage itself. Deliberately not gated on status: proof of
-- delivery often arrives after the work is billed, and there is no invariant
-- an attachment could violate the way editing the amount would.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.set_activity_attachment(
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
    raise exception 'set_activity_attachment: no organisation for this account' using errcode = '28000';
  end if;
  if not exists (select 1 from public.activities where id = p_activity_id and org_id = v_org) then
    raise exception 'set_activity_attachment: activity not found in your organisation' using errcode = 'P0002';
  end if;
  -- The path must actually be this activity's own folder — otherwise a
  -- caller could point one activity at another's (already-authorised)
  -- upload, which would be a confusing cross-reference rather than a
  -- tenancy breach, but there is no reason to allow it.
  if p_attachment_path is not null
     and p_attachment_path !~ ('^' || v_org::text || '/' || p_activity_id::text || '/') then
    raise exception 'set_activity_attachment: path does not belong to this activity' using errcode = '22023';
  end if;

  update public.activities set attachment_path = p_attachment_path where id = p_activity_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'activity.attachment_set', 'activity', p_activity_id,
          jsonb_build_object('attachment_path', p_attachment_path));

  return query select p_activity_id;
end;
$$;

comment on function public.set_activity_attachment(uuid, text) is
  'Records where an already-uploaded proof-of-delivery file landed for an activity. Does not touch storage itself.';

revoke execute on function public.set_activity_attachment(uuid, text) from public;
grant  execute on function public.set_activity_attachment(uuid, text) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.set_activity_attachment(uuid, text);
-- drop policy if exists "activity_attachments_insert" on storage.objects;
-- drop policy if exists "activity_attachments_select" on storage.objects;
-- delete from storage.buckets where id = 'activity-attachments';
-- alter table public.activities drop column if exists attachment_path;
