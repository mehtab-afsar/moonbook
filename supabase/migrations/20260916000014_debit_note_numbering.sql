-- ───────────────────────────────────────────────────────────────────────────
-- 0014 — a debit note is numbered by us, not by the supplier
--
-- Supersedes create_organisation from 20260916000004_numbering.sql, identical
-- signature, body carried forward whole. One value changes: the seeded
-- document_series for 'debit_note' becomes self-numbered.
--
-- THE BUG. A debit note is raised BY this business against a supplier — the
-- payables mirror of a credit note. Seeded as not-self-numbered, issue_document
-- refused to allocate a number and demanded `party_doc_no` instead: the
-- supplier's number for a document the supplier never issued. There is no value
-- that could have been supplied, so no debit note could ever be raised.
--
-- Latent rather than live: payables have no UI by decision, so nothing has
-- reached this path. Fixing it now costs one migration; fixing it after a
-- customer's first supplier dispute costs a support call and a data repair.
--
-- Existing organisations are corrected below. That UPDATE is safe precisely
-- because the broken state was unusable — no debit note exists to renumber,
-- and document_sequences is untouched, so nothing already allocated moves.
--
-- Rollback: re-apply the definition from 20260916000004_numbering.sql and
--   update public.document_series set is_self_numbered = false
--    where doc_kind = 'debit_note';
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.create_organisation(
  p_legal_name    text,
  p_country_code  char(2),
  p_base_currency char(3),
  p_region_code   text default null,
  p_locale        text default 'en',
  p_timezone      text default 'UTC',
  p_fiscal_year_start_month integer default 1,
  p_tax_regime    text default 'none',
  p_default_tax_rate_pct numeric default 0,
  p_tax_id        text default null,
  p_tax_id_kind   text default null,
  p_address       text default null,
  p_full_name     text default null,
  p_invoice_prefix text default 'INV',
  p_credit_note_prefix text default 'CN'
)
returns table (org_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  if v_uid is null then
    raise exception 'create_organisation: no authenticated user' using errcode = '28000';
  end if;

  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'create_organisation: this account already belongs to an organisation'
      using errcode = '23505';
  end if;

  insert into public.organisations (
    legal_name, country_code, region_code, base_currency, locale, timezone,
    fiscal_year_start_month, tax_regime, default_tax_rate_pct,
    tax_id, tax_id_kind, address
  ) values (
    p_legal_name, upper(p_country_code), nullif(p_region_code, ''), upper(p_base_currency),
    p_locale, p_timezone, p_fiscal_year_start_month, p_tax_regime, p_default_tax_rate_pct,
    nullif(p_tax_id, ''), nullif(p_tax_id_kind, ''), nullif(p_address, '')
  )
  returning id into v_org;

  insert into public.profiles (id, org_id, full_name, role)
  values (
    v_uid, v_org,
    coalesce(nullif(p_full_name, ''),
             (select raw_user_meta_data ->> 'full_name' from auth.users where id = v_uid)),
    'owner'
  );

  -- Seed the numbering rules. Receivable kinds are ours to number; payable
  -- kinds are not, so they are created non-self-numbered from the start.
  insert into public.document_series (org_id, doc_kind, prefix, is_self_numbered) values
    (v_org, 'invoice',     upper(p_invoice_prefix),     true),
    (v_org, 'credit_note', upper(p_credit_note_prefix), true),
    -- A bill is the supplier's document: they number it, and issue_document
    -- requires their number instead of allocating one of ours.
    (v_org, 'bill',        'BILL',                      false),
    -- A debit note is OURS. We raise it against a supplier to reduce what we
    -- owe them, exactly as a credit note reduces what a customer owes us, so
    -- we number it. Seeded false until 0014, which meant a debit note could
    -- never be issued: numbering refused, and the counterparty number it fell
    -- back to asking for does not exist, because they never sent one.
    (v_org, 'debit_note',  'DN',                        true);

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'organisation.created', 'organisation', v_org,
          jsonb_build_object('legal_name', p_legal_name, 'country_code', upper(p_country_code),
                             'base_currency', upper(p_base_currency), 'tax_regime', p_tax_regime));

  return query select v_org;
end;
$$;

comment on function public.create_organisation(
  text, char, char, text, text, text, integer, text, numeric, text, text, text, text, text, text
) is 'Creates an organisation, the caller as its owner, and its document series, in one transaction. The only self-serve path onto organisations/profiles. Since 0014 the debit_note series is self-numbered: a debit note is raised by this business against a supplier, so this business numbers it.';

revoke execute on function public.create_organisation(
  text, char, char, text, text, text, integer, text, numeric, text, text, text, text, text, text
) from public;
grant execute on function public.create_organisation(
  text, char, char, text, text, text, integer, text, numeric, text, text, text, text, text, text
) to authenticated;

-- Correct organisations created before this migration. Safe precisely because
-- the broken state was unusable: no debit note exists to renumber, and
-- document_sequences is untouched, so nothing already allocated moves.
update public.document_series
   set is_self_numbered = true
 where doc_kind = 'debit_note'
   and is_self_numbered = false;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- Re-apply create_organisation from 20260916000004_numbering.sql, then:
-- update public.document_series set is_self_numbered = false where doc_kind = 'debit_note';
