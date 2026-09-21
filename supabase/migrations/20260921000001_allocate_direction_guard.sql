-- ═══════════════════════════════════════════════════════════════════════════
-- allocate(): refuse to cross the receivable/payable line.
--
-- Nothing before this checked that a payment's direction matched the target
-- document's direction. That was harmless while every document was
-- receivable, but the moment a payable document (a bill) exists, an 'in'
-- payment (money a customer sent) could be allocated to it — silently
-- recording a vendor's bill as settled by a customer's receipt, corrupting
-- both ledgers. The same gap exists on the credit/debit-note side: a
-- credit_document's own direction must match the target's.
--
-- allocate() already locks the target row, so this check has everything it
-- needs without an extra query beyond what is already selected into v_target.
-- ═══════════════════════════════════════════════════════════════════════════

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
  v_p_dir     text;
  v_c_dir     text;
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
                                     where payment_id = p_payment_id), 0),
           direction
      into v_available, v_p_dir
      from public.payments where id = p_payment_id and org_id = v_org;

    if v_available is null then
      raise exception 'allocate: payment not found in your organisation' using errcode = 'P0002';
    end if;
    -- 'in' money settles what customers owe (receivable); 'out' money settles
    -- what we owe suppliers (payable). One can never stand in for the other.
    if (v_p_dir = 'in' and v_target.direction <> 'receivable')
       or (v_p_dir = 'out' and v_target.direction <> 'payable') then
      raise exception 'allocate: a % payment cannot be applied to a % document', v_p_dir, v_target.direction
        using errcode = '23514';
    end if;
    if p_amount_minor > v_available then
      raise exception 'allocate: % exceeds the % still unapplied on this payment', p_amount_minor, v_available
        using errcode = '22003';
    end if;
  else
    select total_minor - coalesce((select sum(amount_minor) from public.allocations
                                    where credit_document_id = p_credit_document_id), 0),
           direction
      into v_available, v_c_dir
      from public.documents
     where id = p_credit_document_id and org_id = v_org and status = 'issued'
       and doc_kind in ('credit_note', 'debit_note');

    if v_available is null then
      raise exception 'allocate: credit document not found, not issued, or not a note' using errcode = 'P0002';
    end if;
    -- A credit note (receivable) only ever offsets an invoice; a debit note
    -- (payable) only ever offsets a bill.
    if v_c_dir <> v_target.direction then
      raise exception 'allocate: a % note cannot be applied to a % document', v_c_dir, v_target.direction
        using errcode = '23514';
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
  'Applies a payment or a credit/debit note to one document. Locks the target, refuses to cross receivable/payable, and refuses to exceed what is owed on the target or unapplied on the source.';

revoke execute on function public.allocate(uuid, bigint, uuid, uuid) from public;
grant  execute on function public.allocate(uuid, bigint, uuid, uuid) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- Restore the version from 20260916000009_ledger_rpcs.sql (no direction guard).
