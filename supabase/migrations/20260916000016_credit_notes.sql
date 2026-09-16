-- ═══════════════════════════════════════════════════════════════════════════
-- 0016 — issue_credit_note: the instrument for a bill that was wrong
--
-- The schema has supported credit notes since 0006: `doc_kind` allows them,
-- `offsets_document_id` points at what they offset, `allocations` carries a
-- `credit_document_id` branch, and `credit_balances` reports the unapplied
-- ones. Nothing could create one. `issue_document` takes no
-- `offsets_document_id`, and `documents_offset_kind_chk` REQUIRES one for a
-- note — so every attempt would have failed the constraint. The capability was
-- designed, tested by its neighbours, and unreachable.
--
-- That left no way at all to correct a bill once money had moved against it.
-- cancel_document refuses an invoice with anything applied — correctly, since
-- cancelling would orphan the payment — and a credit note is the instrument
-- that exists for exactly that case.
--
-- ONE FUNCTION, BOTH DIRECTIONS. The kind is derived from what is being
-- offset rather than passed in: crediting a receivable invoice raises a credit
-- note, debiting a payable bill raises a debit note. `documents_kind_direction_chk`
-- already insists on that pairing, so deriving it means the caller cannot
-- produce a combination the schema would reject.
--
-- TAX IS NOT RECOMPUTED HERE. It arrives as a breakdown from lib/tax, exactly
-- as issue_document receives it, so there remains one place in the system
-- where tax is decided and the SQL cannot drift from it.
--
-- WHAT IT REFUSES. A note larger than the document it offsets. Crediting more
-- than was ever billed is not a correction, it is a payment out, and it has
-- its own instrument. Exceeding the REMAINING balance is allowed, though: a
-- customer who has already paid in full and is then credited ends up with
-- genuine unapplied credit, which `credit_balances` is there to show.
--
-- Rollback: drop function public.issue_credit_note(...);
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.issue_credit_note(
  p_document_id         uuid,
  p_taxable_value_minor bigint,
  p_total_minor         bigint,
  p_reason              text,
  p_taxes               jsonb default '[]'::jsonb,
  p_lines               jsonb default '[]'::jsonb,
  p_doc_date            date default null,
  p_notes               text default null
)
returns table (document_id uuid, doc_no text, applied_minor bigint)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org      uuid := (select public.current_org_id());
  v_uid      uuid := auth.uid();
  v_target   public.documents;
  v_kind     text;
  v_doc_date date := coalesce(p_doc_date, current_date);
  v_doc_no   text;
  v_note_id  uuid;
  v_balance  bigint;
  v_apply    bigint;
  v_line     jsonb;
  v_tax      jsonb;
  v_snapshot jsonb;
begin
  if v_org is null then
    raise exception 'issue_credit_note: no organisation for this account' using errcode = '28000';
  end if;
  if not (select public.has_role('owner')) then
    raise exception 'issue_credit_note: requires the owner role' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'issue_credit_note: a reason is required' using errcode = '22004';
  end if;
  if p_total_minor <= 0 then
    raise exception 'issue_credit_note: the amount must be positive' using errcode = '22003';
  end if;

  -- Lock the document being offset: its balance decides how much of this note
  -- applies immediately, and two notes raised at once must not both read the
  -- same balance and each apply against it.
  select * into v_target
    from public.documents
   where id = p_document_id and org_id = v_org and status = 'issued'
     and doc_kind in ('invoice', 'bill')
   for update;

  if v_target.id is null then
    raise exception 'issue_credit_note: document not found, not issued, or not a billable kind'
      using errcode = 'P0002';
  end if;

  if p_total_minor > v_target.total_minor then
    raise exception 'issue_credit_note: % is more than the % this document was raised for',
          p_total_minor, v_target.total_minor
      using errcode = '22003';
  end if;

  -- Receivable is credited, payable is debited. The schema's kind/direction
  -- check would reject any other pairing, so it is derived, never passed.
  v_kind := case when v_target.direction = 'receivable' then 'credit_note' else 'debit_note' end;
  v_doc_no := public.next_doc_number(v_kind, v_doc_date);

  insert into public.documents (
    org_id, direction, doc_kind, doc_no, doc_date, counterparty_id,
    offsets_document_id, status, currency, taxable_value_minor, tax_treatment,
    total_minor, notes, created_by
  ) values (
    v_org, v_target.direction, v_kind, v_doc_no, v_doc_date, v_target.counterparty_id,
    p_document_id, 'issued', v_target.currency, p_taxable_value_minor,
    v_target.tax_treatment, p_total_minor, nullif(p_notes, ''), v_uid
  )
  returning id into v_note_id;

  -- A note with no itemisation still says what it is for: the reason becomes
  -- the single line, so the rendered document is never blank in the middle.
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then
    insert into public.document_lines (org_id, document_id, description, amount_minor)
    values (v_org, v_note_id, p_reason, p_taxable_value_minor);
  else
    for v_line in select * from jsonb_array_elements(p_lines) loop
      insert into public.document_lines (
        org_id, document_id, description, hsn_sac, quantity, unit,
        rate_minor, discount_minor, amount_minor
      ) values (
        v_org, v_note_id, v_line->>'description', v_line->>'hsn_sac',
        (v_line->>'quantity')::numeric, v_line->>'unit',
        (v_line->>'rate_minor')::bigint,
        coalesce((v_line->>'discount_minor')::bigint, 0),
        (v_line->>'amount_minor')::bigint
      );
    end loop;
  end if;

  -- Tax components exactly as lib/tax computed them, never recomputed here.
  for v_tax in select * from jsonb_array_elements(coalesce(p_taxes, '[]'::jsonb)) loop
    insert into public.document_taxes (
      org_id, document_id, component_code, component_label, rate_pct, amount_minor, sort_order
    ) values (
      v_org, v_note_id, v_tax->>'component_code', v_tax->>'component_label',
      (v_tax->>'rate_pct')::numeric, (v_tax->>'amount_minor')::bigint,
      coalesce((v_tax->>'sort_order')::integer, 0)
    );
  end loop;

  -- Freeze it, in the shape the renderer parses — the same guarantee an
  -- invoice gets, for the same reason.
  select jsonb_build_object(
           'document',     to_jsonb(d),
           'lines',        coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object('printable_details', '[]'::jsonb)
                                                     order by l.sort_order, l.id)
                                       from public.document_lines l where l.document_id = v_note_id), '[]'::jsonb),
           'taxes',        coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order, x.id)
                                       from public.document_taxes x where x.document_id = v_note_id), '[]'::jsonb),
           'counterparty', (select to_jsonb(p) from public.parties p where p.id = v_target.counterparty_id),
           'ship_to',      null::jsonb,
           'organisation', (select to_jsonb(o) from public.organisations o where o.id = v_org)
         )
    into v_snapshot
    from public.documents d where d.id = v_note_id;

  update public.documents set issued_snapshot = v_snapshot where id = v_note_id;

  -- Apply as much as the document still owes. Anything beyond that stays
  -- unapplied and shows up in credit_balances, rather than being forced onto
  -- a document that no longer needs it.
  -- Aliased. This function declares `returns table (document_id uuid, …)`,
  -- so a bare `document_id` is ambiguous against that output parameter and
  -- Postgres raises 42702 at CALL time — the migration applies perfectly and
  -- the feature fails later.
  select b.balance_due_minor into v_balance
    from public.document_balances b where b.document_id = p_document_id;

  v_apply := least(p_total_minor, greatest(coalesce(v_balance, 0), 0));

  if v_apply > 0 then
    perform public.allocate(p_document_id, v_apply, null, v_note_id);
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after, reason)
  values (v_org, v_uid, 'document.credited', 'document', v_note_id,
          v_snapshot || jsonb_build_object('offsets', p_document_id, 'applied_minor', v_apply),
          p_reason);

  return query select v_note_id, v_doc_no, v_apply;
end;
$$;

comment on function public.issue_credit_note(uuid, bigint, bigint, text, jsonb, jsonb, date, text) is
  'Owner-only. Raises a credit note against a receivable invoice, or a debit note against a payable bill, deriving the kind from the document it offsets. Applies as much as that document still owes and leaves any excess as unapplied credit. Tax is computed in lib/tax and passed in, never recomputed here.';

revoke execute on function public.issue_credit_note(uuid, bigint, bigint, text, jsonb, jsonb, date, text) from public;
grant  execute on function public.issue_credit_note(uuid, bigint, bigint, text, jsonb, jsonb, date, text) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.issue_credit_note(uuid, bigint, bigint, text, jsonb, jsonb, date, text);
