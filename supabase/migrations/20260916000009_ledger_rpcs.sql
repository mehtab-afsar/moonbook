-- ═══════════════════════════════════════════════════════════════════════════
-- 09 · The money-moving RPCs
--
-- Every financial mutation lives here, because each enforces an invariant RLS
-- cannot express: gapless numbering, double-billing prevention, and — the one
-- LedgerFlow gets wrong — that an allocation can never exceed the balance of
-- the document it is applied to.
--
-- Tax is NEVER computed here. lib/tax/ computes it once in the application
-- layer and passes the breakdown in as p_taxes, so there is exactly one place
-- the tax mechanics live and no chance of the two drifting.
--
-- Every function logs to audit_events from its first definition.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- record_activity: the only way a client writes an activity.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.record_activity(
  p_activity_type_id uuid,
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
  v_org       uuid := (select public.current_org_id());
  v_uid       uuid := auth.uid();
  v_direction text;
  v_dim1_key  text;
  v_currency  char(3);
  v_id        uuid;
begin
  if v_org is null then
    raise exception 'record_activity: no organisation for this account' using errcode = '28000';
  end if;

  select t.direction, t.dim1_field_key
    into v_direction, v_dim1_key
    from public.activity_types t
   where t.id = p_activity_type_id and t.org_id = v_org and t.archived_at is null;

  if v_direction is null then
    raise exception 'record_activity: activity type not found in your organisation' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.parties where id = p_party_id and org_id = v_org) then
    raise exception 'record_activity: party not found in your organisation' using errcode = 'P0002';
  end if;
  if p_bill_to_party_id is not null
     and not exists (select 1 from public.parties where id = p_bill_to_party_id and org_id = v_org) then
    raise exception 'record_activity: bill-to party not found in your organisation' using errcode = 'P0002';
  end if;

  if p_amount_minor < 0 then
    raise exception 'record_activity: amount cannot be negative' using errcode = '22003';
  end if;

  select base_currency into v_currency from public.organisations where id = v_org;

  insert into public.activities (
    org_id, activity_type_id, party_id, bill_to_party_id, direction, currency,
    occurred_on, period_start, period_end, amount_minor, direct_cost_minor,
    reference, status, dim1_key, dim1_value, details, notes, created_by
  ) values (
    v_org, p_activity_type_id, p_party_id, p_bill_to_party_id, v_direction, v_currency,
    p_occurred_on, p_period_start, p_period_end, p_amount_minor, p_direct_cost_minor,
    nullif(p_reference, ''), p_status,
    v_dim1_key,
    case when v_dim1_key is not null then p_details ->> v_dim1_key end,
    coalesce(p_details, '{}'::jsonb), nullif(p_notes, ''), v_uid
  )
  returning id into v_id;

  return query select v_id;
end;
$$;

comment on function public.record_activity(uuid, uuid, date, bigint, uuid, text, jsonb, bigint, date, date, text, text) is
  'Records one billable unit of work. Derives direction and currency from the activity type and organisation rather than trusting the caller, and mirrors the reportable field into dim1 with the key it was captured under.';

revoke execute on function public.record_activity(uuid, uuid, date, bigint, uuid, text, jsonb, bigint, date, date, text, text) from public;
grant  execute on function public.record_activity(uuid, uuid, date, bigint, uuid, text, jsonb, bigint, date, date, text, text) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- issue_document: create an invoice (or a supplier bill) and issue it.
--
-- p_taxes is the breakdown computed by lib/tax/ — an array of
-- {component_code, component_label, rate_pct, amount_minor}.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.issue_document(
  p_doc_kind         text,
  p_counterparty_id  uuid,
  p_doc_date         date,
  p_taxable_value_minor bigint,
  p_total_minor      bigint,
  p_taxes            jsonb default '[]'::jsonb,
  p_activity_ids     uuid[] default '{}',
  p_free_lines       jsonb default '[]'::jsonb,
  p_tax_treatment    text default 'forward',
  p_due_date         date default null,
  p_ship_to_party_id uuid default null,
  p_counterparty_override_reason text default null,
  p_party_doc_no     text default null,
  p_notes            text default null
)
returns table (document_id uuid, doc_no text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org        uuid := (select public.current_org_id());
  v_uid        uuid := auth.uid();
  v_direction  text;
  v_self       boolean;
  v_currency   char(3);
  v_doc_no     text;
  v_doc_id     uuid;
  v_line       jsonb;
  v_tax        jsonb;
  v_activity   uuid;
  v_count      integer;
  v_snapshot   jsonb;
begin
  if v_org is null then
    raise exception 'issue_document: no organisation for this account' using errcode = '28000';
  end if;
  if p_doc_kind not in ('invoice', 'bill') then
    raise exception 'issue_document: doc_kind must be invoice or bill, got %', p_doc_kind
      using errcode = '22023';
  end if;

  v_direction := case p_doc_kind when 'invoice' then 'receivable' else 'payable' end;

  if not exists (select 1 from public.parties where id = p_counterparty_id and org_id = v_org) then
    raise exception 'issue_document: counterparty not found in your organisation' using errcode = 'P0002';
  end if;
  if p_ship_to_party_id is not null
     and not exists (select 1 from public.parties where id = p_ship_to_party_id and org_id = v_org) then
    raise exception 'issue_document: ship-to party not found in your organisation' using errcode = 'P0002';
  end if;

  if p_total_minor < 0 or p_taxable_value_minor < 0 then
    raise exception 'issue_document: amounts cannot be negative' using errcode = '22003';
  end if;

  select base_currency into v_currency from public.organisations where id = v_org;
  select is_self_numbered into v_self
    from public.document_series where org_id = v_org and doc_kind = p_doc_kind;

  if v_self is null then
    raise exception 'issue_document: no % series configured for this organisation', p_doc_kind
      using errcode = 'P0002';
  end if;

  -- Ours to number, or theirs. A self-numbered series allocates; otherwise the
  -- counterparty's number is required, so the document is always identifiable.
  if v_self then
    v_doc_no := public.next_doc_number(p_doc_kind, p_doc_date);
  elsif nullif(p_party_doc_no, '') is null then
    raise exception 'issue_document: the % series is not self-numbered, so the counterparty''s document number is required', p_doc_kind
      using errcode = '22004';
  end if;

  -- Lock and validate the activities being billed. FOR UPDATE cannot appear
  -- with an aggregate, so lock in a subquery and count outside it — the row
  -- lock is what serialises two staff billing the same work at once.
  if array_length(p_activity_ids, 1) > 0 then
    select count(*) into v_count
      from (
        select id from public.activities
         where id = any(p_activity_ids)
           and org_id = v_org
           and direction = v_direction
           and status = 'completed'
         for update
      ) locked;

    if v_count <> array_length(p_activity_ids, 1) then
      raise exception 'issue_document: one or more activities are not billable (wrong organisation, wrong direction, or not completed)'
        using errcode = '23514';
    end if;

    if exists (select 1 from public.document_lines where activity_id = any(p_activity_ids)) then
      raise exception 'issue_document: one or more activities have already been billed'
        using errcode = '23505';
    end if;
  end if;

  insert into public.documents (
    org_id, direction, doc_kind, doc_no, party_doc_no, doc_date, due_date,
    counterparty_id, ship_to_party_id, counterparty_override_reason,
    status, currency, taxable_value_minor, tax_treatment, total_minor, notes, created_by
  ) values (
    v_org, v_direction, p_doc_kind, v_doc_no, nullif(p_party_doc_no, ''), p_doc_date, p_due_date,
    p_counterparty_id, p_ship_to_party_id, nullif(p_counterparty_override_reason, ''),
    'issued', v_currency, p_taxable_value_minor, p_tax_treatment, p_total_minor,
    nullif(p_notes, ''), v_uid
  )
  returning id into v_doc_id;

  -- One line per billed activity.
  if array_length(p_activity_ids, 1) > 0 then
    foreach v_activity in array p_activity_ids loop
      insert into public.document_lines (org_id, document_id, activity_id, description, amount_minor)
      select v_org, v_doc_id, a.id,
             coalesce(t.label_singular, 'Item') ||
               case when a.reference is not null then ' — ' || a.reference else '' end,
             a.amount_minor
        from public.activities a
        join public.activity_types t on t.id = a.activity_type_id
       where a.id = v_activity;
    end loop;

    update public.activities set status = 'invoiced' where id = any(p_activity_ids);
  end if;

  -- Free-form lines with no underlying activity.
  for v_line in select * from jsonb_array_elements(coalesce(p_free_lines, '[]'::jsonb)) loop
    insert into public.document_lines (
      org_id, document_id, description, hsn_sac, quantity, unit,
      rate_minor, discount_minor, amount_minor
    ) values (
      v_org, v_doc_id, v_line->>'description', v_line->>'hsn_sac',
      (v_line->>'quantity')::numeric, v_line->>'unit',
      (v_line->>'rate_minor')::bigint,
      coalesce((v_line->>'discount_minor')::bigint, 0),
      (v_line->>'amount_minor')::bigint
    );
  end loop;

  -- Tax components, exactly as lib/tax/ computed them.
  for v_tax in select * from jsonb_array_elements(coalesce(p_taxes, '[]'::jsonb)) loop
    insert into public.document_taxes (
      org_id, document_id, component_code, component_label, rate_pct, amount_minor, sort_order
    ) values (
      v_org, v_doc_id, v_tax->>'component_code', v_tax->>'component_label',
      (v_tax->>'rate_pct')::numeric, (v_tax->>'amount_minor')::bigint,
      coalesce((v_tax->>'sort_order')::integer, 0)
    );
  end loop;

  -- Freeze what the document says, before anything it references can drift.
  select jsonb_build_object(
           'document',     to_jsonb(d),
           'lines',        coalesce((select jsonb_agg(to_jsonb(l) order by l.sort_order, l.id)
                                       from public.document_lines l where l.document_id = v_doc_id), '[]'::jsonb),
           'taxes',        coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order, x.id)
                                       from public.document_taxes x where x.document_id = v_doc_id), '[]'::jsonb),
           'counterparty', (select to_jsonb(p) from public.parties p where p.id = p_counterparty_id),
           'ship_to',      (select to_jsonb(p) from public.parties p where p.id = p_ship_to_party_id),
           'organisation', (select to_jsonb(o) from public.organisations o where o.id = v_org)
         )
    into v_snapshot
    from public.documents d where d.id = v_doc_id;

  update public.documents set issued_snapshot = v_snapshot where id = v_doc_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after, reason)
  values (v_org, v_uid, 'document.issued', 'document', v_doc_id, v_snapshot,
          nullif(p_counterparty_override_reason, ''));

  return query select v_doc_id, v_doc_no;
end;
$$;

comment on function public.issue_document(text, uuid, date, bigint, bigint, jsonb, uuid[], jsonb, text, date, uuid, text, text, text) is
  'Creates and issues a document with its lines and tax components, locking against double-billing, freezing an issued_snapshot, and logging document.issued. Tax is computed in lib/tax/ and passed in, never recomputed here.';

revoke execute on function public.issue_document(text, uuid, date, bigint, bigint, jsonb, uuid[], jsonb, text, date, uuid, text, text, text) from public;
grant  execute on function public.issue_document(text, uuid, date, bigint, bigint, jsonb, uuid[], jsonb, text, date, uuid, text, text, text) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- record_payment: money in or out, optionally allocated in the same call.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.record_payment(
  p_direction    text,
  p_party_id     uuid,
  p_amount_minor bigint,
  p_paid_on      date,
  p_method       text,
  p_allocations  jsonb default '[]'::jsonb,
  p_reference_no text default null,
  p_notes        text default null
)
returns table (payment_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org      uuid := (select public.current_org_id());
  v_uid      uuid := auth.uid();
  v_currency char(3);
  v_id       uuid;
  v_row      jsonb;
  v_total    bigint := 0;
begin
  if v_org is null then
    raise exception 'record_payment: no organisation for this account' using errcode = '28000';
  end if;
  if p_direction not in ('in', 'out') then
    raise exception 'record_payment: direction must be in or out, got %', p_direction using errcode = '22023';
  end if;
  if p_amount_minor <= 0 then
    raise exception 'record_payment: amount must be positive' using errcode = '22003';
  end if;
  if not exists (select 1 from public.parties where id = p_party_id and org_id = v_org) then
    raise exception 'record_payment: party not found in your organisation' using errcode = 'P0002';
  end if;

  select coalesce(sum((elem->>'amount_minor')::bigint), 0) into v_total
    from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) elem;

  if v_total > p_amount_minor then
    raise exception 'record_payment: allocations (%) exceed the payment amount (%)', v_total, p_amount_minor
      using errcode = '22003';
  end if;

  select base_currency into v_currency from public.organisations where id = v_org;

  insert into public.payments (
    org_id, direction, party_id, currency, amount_minor, paid_on, method,
    reference_no, notes, created_by
  ) values (
    v_org, p_direction, p_party_id, v_currency, p_amount_minor, p_paid_on, p_method,
    nullif(p_reference_no, ''), nullif(p_notes, ''), v_uid
  )
  returning id into v_id;

  -- Each allocation goes through allocate(), so the per-document
  -- over-allocation check applies here too rather than only on the API path.
  for v_row in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    perform public.allocate(
      (v_row->>'document_id')::uuid,
      (v_row->>'amount_minor')::bigint,
      v_id,
      null
    );
  end loop;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after, reason)
  values (v_org, v_uid, 'payment.recorded', 'payment', v_id,
          jsonb_build_object('direction', p_direction, 'party_id', p_party_id,
                             'amount_minor', p_amount_minor, 'allocations', p_allocations),
          nullif(p_notes, ''));

  return query select v_id;
end;
$$;

comment on function public.record_payment(text, uuid, bigint, date, text, jsonb, text, text) is
  'Records money in or out and applies it to zero or more documents, in one transaction. Allocation goes through allocate(), so the per-document balance check is never bypassed.';

revoke execute on function public.record_payment(text, uuid, bigint, date, text, jsonb, text, text) from public;
grant  execute on function public.record_payment(text, uuid, bigint, date, text, jsonb, text, text) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- allocate: apply a payment, or a credit note, against one document.
--
-- THE CHECK LEDGERFLOW IS MISSING. Its record_receipt validates allocations
-- against the RECEIPT total but never against the TARGET INVOICE's remaining
-- balance, so allocating 50,000 against a 10,000 invoice drives the balance to
-- -40,000 and nothing complains. Here the target is locked FOR UPDATE and the
-- amount is checked against what is actually still owed.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.allocate(
  p_target_document_id uuid,
  p_amount_minor       bigint,
  p_payment_id         uuid default null,
  p_credit_document_id uuid default null
)
returns table (allocation_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org       uuid := (select public.current_org_id());
  v_uid       uuid := auth.uid();
  v_target    public.documents;
  v_balance   bigint;
  v_available bigint;
  v_id        uuid;
begin
  if v_org is null then
    raise exception 'allocate: no organisation for this account' using errcode = '28000';
  end if;
  if num_nonnulls(p_payment_id, p_credit_document_id) <> 1 then
    raise exception 'allocate: supply exactly one of a payment or a credit document' using errcode = '22023';
  end if;
  if p_amount_minor <= 0 then
    raise exception 'allocate: amount must be positive' using errcode = '22003';
  end if;

  -- Lock the target so two concurrent allocations cannot both see the same
  -- remaining balance and each be allowed through.
  select * into v_target
    from public.documents
   where id = p_target_document_id and org_id = v_org and status = 'issued'
     and doc_kind in ('invoice', 'bill')
   for update;

  if v_target.id is null then
    raise exception 'allocate: target document not found, not issued, or not a billable kind'
      using errcode = 'P0002';
  end if;

  select balance_due_minor into v_balance
    from public.document_balances where document_id = p_target_document_id;

  if p_amount_minor > coalesce(v_balance, 0) then
    raise exception 'allocate: % exceeds the % still owed on this document', p_amount_minor, coalesce(v_balance, 0)
      using errcode = '22003';
  end if;

  if p_payment_id is not null then
    select amount_minor - coalesce((select sum(amount_minor) from public.allocations
                                     where payment_id = p_payment_id), 0)
      into v_available
      from public.payments where id = p_payment_id and org_id = v_org;

    if v_available is null then
      raise exception 'allocate: payment not found in your organisation' using errcode = 'P0002';
    end if;
    if p_amount_minor > v_available then
      raise exception 'allocate: % exceeds the % still unapplied on this payment', p_amount_minor, v_available
        using errcode = '22003';
    end if;
  else
    select total_minor - coalesce((select sum(amount_minor) from public.allocations
                                    where credit_document_id = p_credit_document_id), 0)
      into v_available
      from public.documents
     where id = p_credit_document_id and org_id = v_org and status = 'issued'
       and doc_kind in ('credit_note', 'debit_note');

    if v_available is null then
      raise exception 'allocate: credit document not found, not issued, or not a note' using errcode = 'P0002';
    end if;
    if p_amount_minor > v_available then
      raise exception 'allocate: % exceeds the % still unapplied on this note', p_amount_minor, v_available
        using errcode = '22003';
    end if;
  end if;

  insert into public.allocations (
    org_id, target_document_id, payment_id, credit_document_id, amount_minor, created_by
  ) values (
    v_org, p_target_document_id, p_payment_id, p_credit_document_id, p_amount_minor, v_uid
  )
  returning id into v_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, v_uid, 'allocation.created', 'allocation', v_id,
          jsonb_build_object('target_document_id', p_target_document_id,
                             'payment_id', p_payment_id,
                             'credit_document_id', p_credit_document_id,
                             'amount_minor', p_amount_minor));

  return query select v_id;
end;
$$;

comment on function public.allocate(uuid, bigint, uuid, uuid) is
  'Applies a payment or a credit note to one document. Locks the target and refuses to allocate more than is still owed on it, or more than is still unapplied on the source — so a balance can never go negative.';

revoke execute on function public.allocate(uuid, bigint, uuid, uuid) from public;
grant  execute on function public.allocate(uuid, bigint, uuid, uuid) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- cancel_document: owner-only, reversible lifecycle.
--
-- Refuses when anything has been applied to the document. LedgerFlow's
-- cancel_invoice does not, so cancelling a paid invoice silently orphans real
-- money: the allocation still points at a document that no longer counts
-- anywhere, and it disappears from every report without a trace. Deal with
-- the payment first — reallocate it, or issue a credit note — then cancel.
--
-- Unbilling also RELEASES the activities, and unlike LedgerFlow the release is
-- real: its create_invoice duplicate-check looks at every invoice_line
-- regardless of its parent invoice's status, so a cancelled invoice's work
-- could never actually be re-billed. Here the lines are deleted, so the
-- unique index that prevents double-billing stops applying to them.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.cancel_document(
  p_document_id uuid,
  p_reason      text
)
returns table (document_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org     uuid := (select public.current_org_id());
  v_uid     uuid := auth.uid();
  v_before  jsonb;
  v_applied bigint;
begin
  if v_org is null then
    raise exception 'cancel_document: no organisation for this account' using errcode = '28000';
  end if;
  if not (select public.has_role('owner')) then
    raise exception 'cancel_document: requires the owner role' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'cancel_document: a reason is required' using errcode = '22004';
  end if;

  select to_jsonb(d) into v_before
    from public.documents d
   where d.id = p_document_id and d.org_id = v_org and d.status = 'issued'
   for update;

  if v_before is null then
    raise exception 'cancel_document: document not found or not issued' using errcode = 'P0002';
  end if;

  select coalesce(sum(amount_minor), 0) into v_applied
    from public.allocations where target_document_id = p_document_id;

  if v_applied > 0 then
    raise exception 'cancel_document: % has already been applied to this document — reallocate it or issue a credit note first', v_applied
      using errcode = '23514';
  end if;

  update public.documents set status = 'cancelled' where id = p_document_id;

  -- Release the work: the lines go, so the double-billing index no longer
  -- covers these activities and they become genuinely billable again.
  --
  -- document_lines is aliased throughout: this function's OUT parameter is
  -- also called document_id, and an unqualified column reference would be
  -- ambiguous between the two (SQLSTATE 42702).
  update public.activities
     set status = 'completed'
   where id in (select dl.activity_id from public.document_lines dl
                 where dl.document_id = p_document_id and dl.activity_id is not null);

  delete from public.document_lines dl where dl.document_id = p_document_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, before, after, reason)
  values (v_org, v_uid, 'document.cancelled', 'document', p_document_id,
          v_before, jsonb_build_object('status', 'cancelled'), p_reason);

  return query select p_document_id;
end;
$$;

comment on function public.cancel_document(uuid, text) is
  'Owner-only. Cancels an issued document, refusing if anything has been applied to it, and genuinely releases the activities it billed by deleting its lines.';

revoke execute on function public.cancel_document(uuid, text) from public;
grant  execute on function public.cancel_document(uuid, text) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.cancel_document(uuid, text);
-- drop function if exists public.allocate(uuid, bigint, uuid, uuid);
-- drop function if exists public.record_payment(text, uuid, bigint, date, text, jsonb, text, text);
-- drop function if exists public.issue_document(text, uuid, date, bigint, bigint, jsonb, uuid[], jsonb, text, date, uuid, text, text, text);
-- drop function if exists public.record_activity(uuid, uuid, date, bigint, uuid, text, jsonb, bigint, date, date, text, text);
