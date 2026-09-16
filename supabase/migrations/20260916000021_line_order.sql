-- ═══════════════════════════════════════════════════════════════════════════
-- 0021 — invoice lines keep the order they were chosen in
--
-- Base version carried forward: issue_document from
-- 20260916000017_owner_only_money.sql.
--
-- document_lines.sort_order defaults to 0 and issue_document never set it, so
-- every line on an invoice had the same sort key. The snapshot orders by
-- `sort_order, id`, which meant the tie was broken by a random uuid: the lines
-- came out in an arbitrary order, stable for a given document and matching
-- nothing a person had done.
--
-- On a freight invoice with one line, invisible. On a wholesale delivery of
-- twenty products it is the difference between a document someone can check
-- against a packing list and one they cannot. Found by billing three products
-- and getting them back shuffled.
--
-- Rollback: re-apply issue_document from 20260916000017_owner_only_money.sql.
-- ═══════════════════════════════════════════════════════════════════════════

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
  v_sort       integer := 0;
  v_tax        jsonb;
  v_activity   uuid;
  v_count      integer;
  v_snapshot   jsonb;
begin
  if v_org is null then
    raise exception 'issue_document: no organisation for this account' using errcode = '28000';
  end if;
  if not (select public.has_role('owner')) then
    raise exception 'issue_document: requires the owner role' using errcode = '42501';
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
      insert into public.document_lines (org_id, document_id, activity_id, description, amount_minor, sort_order)
      select v_org, v_doc_id, a.id,
             coalesce(t.label_singular, 'Item') ||
               case when a.reference is not null then ' — ' || a.reference else '' end,
             a.amount_minor,
             v_sort
        from public.activities a
        join public.activity_types t on t.id = a.activity_type_id
       where a.id = v_activity;

      v_sort := v_sort + 1;
    end loop;

    update public.activities set status = 'invoiced' where id = any(p_activity_ids);
  end if;

  -- Free-form lines with no underlying activity.
  for v_line in select * from jsonb_array_elements(coalesce(p_free_lines, '[]'::jsonb)) loop
    insert into public.document_lines (
      org_id, document_id, description, hsn_sac, quantity, unit,
      rate_minor, discount_minor, amount_minor
      , sort_order
    ) values (
      v_org, v_doc_id, v_line->>'description', v_line->>'hsn_sac',
      (v_line->>'quantity')::numeric, v_line->>'unit',
      (v_line->>'rate_minor')::bigint,
      coalesce((v_line->>'discount_minor')::bigint, 0),
      (v_line->>'amount_minor')::bigint,
      v_sort
    );

    v_sort := v_sort + 1;
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
           'lines',        coalesce((
                             select jsonb_agg(
                                      to_jsonb(l) || jsonb_build_object(
                                        'printable_details', coalesce(pd.items, '[]'::jsonb))
                                      order by l.sort_order, l.id)
                               from public.document_lines l
                               left join lateral (
                                 -- The ONLY path by which `details` reaches a
                                 -- document, and it is a one-way trip: the
                                 -- values are frozen here as rendered text and
                                 -- nothing financial ever reads them back.
                                 --
                                 -- The LABEL is frozen alongside the value, so
                                 -- renaming "Material grade" or archiving the
                                 -- field next year cannot retroactively change
                                 -- what an already-issued invoice says.
                                 select jsonb_agg(
                                          jsonb_build_object(
                                            'label', f.label,
                                            'value', a.details->>f.key)
                                          order by f.sort_order, f.id) as items
                                   from public.activities a
                                   join public.activity_fields f
                                     on f.activity_type_id = a.activity_type_id
                                  where a.id = l.activity_id
                                    and f.show_on_document
                                    and coalesce(a.details->>f.key, '') <> ''
                               ) pd on true
                              where l.document_id = v_doc_id), '[]'::jsonb),
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
  if not (select public.has_role('owner')) then
    raise exception 'record_payment: requires the owner role' using errcode = '42501';
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

comment on function public.issue_document(text, uuid, date, bigint, bigint, jsonb, uuid[], jsonb, text, date, uuid, text, text, text) is
  'Owner-only since 0017. Creates and issues a document with its lines and tax components, locking against double-billing, freezing an issued_snapshot, and logging document.issued. Tax is computed in lib/tax/ and passed in, never recomputed here. The snapshot freezes each line''s printable activity details. Since 0021 lines carry the order they were chosen in.';

revoke execute on function public.issue_document(text, uuid, date, bigint, bigint, jsonb, uuid[], jsonb, text, date, uuid, text, text, text) from public;
grant  execute on function public.issue_document(text, uuid, date, bigint, bigint, jsonb, uuid[], jsonb, text, date, uuid, text, text, text) to authenticated;
