-- ═══════════════════════════════════════════════════════════════════════════
-- A logo on the invoice/receipt letterhead — every business on Moonbook is
-- already its own isolated organisation (its own settings row, its own RLS
-- boundary), so "configuring this for multiple companies" is already solved
-- by tenancy; the one piece actually missing is a place to put the image.
-- One logo per org, small, private bucket — same shape as activity
-- attachments (20260922000003_activity_attachments.sql), scoped the same way.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.organisations
  add column if not exists logo_path text;

comment on column public.organisations.logo_path is
  'Path within the org-logos storage bucket, {org_id}/logo.{ext}. Set via set_org_logo(), never written directly.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-logos', 'org-logos', false,
  2097152, -- 2 MB — a mark or wordmark, not a photo
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "org_logos_select" on storage.objects;
create policy "org_logos_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
  );

drop policy if exists "org_logos_insert" on storage.objects;
create policy "org_logos_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
  );

-- Uploading a new logo replaces the old file at a fresh path (see the API
-- route) rather than overwriting in place, so the old object needs an
-- explicit delete policy — upload alone would just leak the previous one.
drop policy if exists "org_logos_delete" on storage.objects;
create policy "org_logos_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'org-logos'
    and (storage.foldername(name))[1] = (select public.current_org_id())::text
  );

-- ───────────────────────────────────────────────────────────────────────────
-- set_org_logo: point the organisation at an already-uploaded object (or
-- clear it with null). Owner-only, same as everything else in Settings that
-- changes what the business looks like on paper.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.set_org_logo(
  p_logo_path text
)
returns table (org_id uuid)
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
    raise exception 'set_org_logo: no organisation for this account' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.org_id = v_org and p.role = 'owner') then
    raise exception 'set_org_logo: only an owner can change the logo' using errcode = '42501';
  end if;
  if p_logo_path is not null and p_logo_path !~ ('^' || v_org::text || '/') then
    raise exception 'set_org_logo: path does not belong to this organisation' using errcode = '22023';
  end if;

  update public.organisations set logo_path = p_logo_path where id = v_org;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'organisation.logo_set', 'organisation', v_org,
          jsonb_build_object('logo_path', p_logo_path));

  return query select v_org;
end;
$$;

revoke execute on function public.set_org_logo(text) from public;
grant  execute on function public.set_org_logo(text) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.set_org_logo(text);
-- drop policy if exists "org_logos_delete" on storage.objects;
-- drop policy if exists "org_logos_insert" on storage.objects;
-- drop policy if exists "org_logos_select" on storage.objects;
-- delete from storage.buckets where id = 'org-logos';
-- alter table public.organisations drop column if exists logo_path;
