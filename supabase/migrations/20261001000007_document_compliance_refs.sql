-- ═══════════════════════════════════════════════════════════════════════════
-- E-way bill and e-invoice (IRN/QR) reference fields — recorded, not
-- generated.
--
-- Moonbook has no GSTN API integration: no e-way bill portal client, no
-- Invoice Registration Portal client, no credentials to hold one. Building
-- against those without real sandbox/production access would be untested
-- code pretending to work. What ships here instead is the honest, useful
-- half of the feature: a place to RECORD the e-way bill number and the IRN/
-- QR a business already generates by hand on the government portals today
-- (the common path for a small business without API access), so it prints
-- on the invoice and travels with it — same shape LedgerFlow-adjacent tools
-- give this, minus the pretence of automation that isn't there.
--
-- The automation itself (calling the e-way bill and IRP APIs directly) is a
-- real, separate, larger piece of future work, gated on this business
-- actually holding GSTN API credentials — not something to fake here.
--
-- Nullable throughout, on `documents` (the shared ledger only, matching the
-- scope of 20261001000005/6's per-line-rate and GSTR-1 work) — a document
-- with neither field set is simply a document nothing has been filed for
-- yet, which is most of them, most of the time.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.documents
  add column if not exists ewb_no text,
  add column if not exists ewb_valid_until timestamptz,
  add column if not exists irn text,
  add column if not exists irn_ack_no text,
  add column if not exists irn_ack_date date,
  add column if not exists qr_code_data text,
  add column if not exists einvoice_status text not null default 'not_applicable';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_ewb_no_chk') then
    alter table public.documents
      add constraint documents_ewb_no_chk
      check (ewb_no is null or ewb_no ~ '^[0-9]{12}$');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_irn_chk') then
    alter table public.documents
      add constraint documents_irn_chk
      check (irn is null or irn ~ '^[0-9a-fA-F]{64}$');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_einvoice_status_chk') then
    alter table public.documents
      add constraint documents_einvoice_status_chk
      check (einvoice_status in ('not_applicable', 'pending', 'generated', 'cancelled'));
  end if;
end $$;

comment on column public.documents.ewb_no is
  'The e-way bill number from the government e-way bill portal, entered by hand — Moonbook has no e-way bill API integration. 12 digits, per the portal''s own format.';
comment on column public.documents.ewb_valid_until is
  'The e-way bill''s own stated validity end, also entered by hand.';
comment on column public.documents.irn is
  'Invoice Reference Number from the government Invoice Registration Portal, entered by hand — Moonbook has no e-invoicing API integration. 64 hex characters, per the portal''s own format.';
comment on column public.documents.irn_ack_no is 'The IRP''s acknowledgement number for this IRN, entered by hand.';
comment on column public.documents.irn_ack_date is 'The IRP''s acknowledgement date for this IRN, entered by hand.';
comment on column public.documents.qr_code_data is
  'The signed QR payload string the IRP returned, entered by hand. Printed as text on the PDF today; rendering it as a scannable QR image is real, separate follow-up work (a QR-generation library is not yet a dependency of this project).';
comment on column public.documents.einvoice_status is
  'not_applicable (default — most documents), pending, generated or cancelled. Set alongside the IRN fields by set_document_compliance_refs(); this app never talks to the IRP directly.';

-- ───────────────────────────────────────────────────────────────────────────
-- set_document_compliance_refs: owner-only, same guard shape as the other
-- per-organisation setters — full replace of all seven fields at once,
-- matching update_activity's own reasoning: a partial PATCH would need NULL
-- to mean "leave alone," which makes clearing a field impossible.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.set_document_compliance_refs(
  p_document_id      uuid,
  p_ewb_no           text default null,
  p_ewb_valid_until  timestamptz default null,
  p_irn              text default null,
  p_irn_ack_no       text default null,
  p_irn_ack_date     date default null,
  p_qr_code_data     text default null,
  p_einvoice_status  text default 'not_applicable'
)
returns table (document_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org    uuid := (select public.current_org_id());
  v_uid    uuid := auth.uid();
  v_status text;
begin
  if v_org is null then
    raise exception 'set_document_compliance_refs: no organisation for this account' using errcode = '28000';
  end if;
  if not (select public.has_role('owner')) then
    raise exception 'set_document_compliance_refs: requires the owner role' using errcode = '42501';
  end if;
  if p_einvoice_status not in ('not_applicable', 'pending', 'generated', 'cancelled') then
    raise exception 'set_document_compliance_refs: unknown e-invoice status %', p_einvoice_status
      using errcode = '22023';
  end if;
  if p_ewb_no is not null and p_ewb_no !~ '^[0-9]{12}$' then
    raise exception 'set_document_compliance_refs: e-way bill number must be exactly 12 digits' using errcode = '22023';
  end if;
  if p_irn is not null and p_irn !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'set_document_compliance_refs: IRN must be 64 hex characters' using errcode = '22023';
  end if;

  select status into v_status from public.documents where id = p_document_id and org_id = v_org;
  if v_status is null then
    raise exception 'set_document_compliance_refs: document not found in your organisation' using errcode = 'P0002';
  end if;
  if v_status <> 'issued' then
    raise exception 'set_document_compliance_refs: only an issued document can carry these references' using errcode = '23514';
  end if;

  update public.documents set
    ewb_no          = nullif(p_ewb_no, ''),
    ewb_valid_until = p_ewb_valid_until,
    irn             = nullif(p_irn, ''),
    irn_ack_no      = nullif(p_irn_ack_no, ''),
    irn_ack_date    = p_irn_ack_date,
    qr_code_data    = nullif(p_qr_code_data, ''),
    einvoice_status = p_einvoice_status
  where id = p_document_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'document.compliance_refs_set', 'document', p_document_id,
          jsonb_build_object(
            'ewb_no', p_ewb_no, 'irn', p_irn, 'irn_ack_no', p_irn_ack_no,
            'einvoice_status', p_einvoice_status));

  return query select p_document_id;
end;
$$;

revoke execute on function public.set_document_compliance_refs(uuid, text, timestamptz, text, text, date, text, text) from public;
grant  execute on function public.set_document_compliance_refs(uuid, text, timestamptz, text, text, date, text, text) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.set_document_compliance_refs(uuid, text, timestamptz, text, text, date, text, text);
-- alter table public.documents drop constraint if exists documents_einvoice_status_chk;
-- alter table public.documents drop constraint if exists documents_irn_chk;
-- alter table public.documents drop constraint if exists documents_ewb_no_chk;
-- alter table public.documents
--   drop column if exists einvoice_status,
--   drop column if exists qr_code_data,
--   drop column if exists irn_ack_date,
--   drop column if exists irn_ack_no,
--   drop column if exists irn,
--   drop column if exists ewb_valid_until,
--   drop column if exists ewb_no;
