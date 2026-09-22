-- ═══════════════════════════════════════════════════════════════════════════
-- 30 · allocate(): lock the SOURCE row too, not just the target
--
-- Each allocate() variant already locks the target document with `for
-- update` before reading its balance, which correctly serialises two
-- concurrent allocations against the same document. But the "how much of
-- this payment/note is still unapplied" check on the other side was a plain
-- SELECT with no lock. Two concurrent calls allocating the SAME payment (or
-- credit/debit note) to two DIFFERENT target documents could both read the
-- same "already allocated" sum before either commits its new allocation row
-- — both pass the "amount <= available" check, and the payment ends up
-- over-allocated beyond its own amount_minor.
--
-- Fix: `for update` on the payment/credit-document row too, read after the
-- lock is held. This can't deadlock against the existing target-document
-- lock: every call in every one of these functions locks (target, then
-- source) in that fixed order, never the reverse, so two calls can only ever
-- queue on one row at a time, not circle back on each other.
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
  v_found     boolean;
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
    -- Locked before reading "already allocated" — see header.
    select true, direction into v_found, v_p_dir
      from public.payments where id = p_payment_id and org_id = v_org
      for update;

    if v_found is null then
      raise exception 'allocate: payment not found in your organisation' using errcode = 'P0002';
    end if;

    select amount_minor - coalesce((select sum(amount_minor) from public.allocations
                                     where payment_id = p_payment_id), 0)
      into v_available
      from public.payments where id = p_payment_id;

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
    -- Locked before reading "already allocated" — see header.
    select true, direction into v_found, v_c_dir
      from public.documents
     where id = p_credit_document_id and org_id = v_org and status = 'issued'
       and doc_kind in ('credit_note', 'debit_note')
     for update;

    if v_found is null then
      raise exception 'allocate: credit document not found, not issued, or not a note' using errcode = 'P0002';
    end if;

    select total_minor - coalesce((select sum(amount_minor) from public.allocations
                                    where credit_document_id = p_credit_document_id), 0)
      into v_available
      from public.documents where id = p_credit_document_id;

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
  'Applies a payment or a credit/debit note to one document. Locks both the target and the source (payment or note) row, refuses to cross receivable/payable, and refuses to exceed what is owed on the target or unapplied on the source.';

revoke execute on function public.allocate(uuid, bigint, uuid, uuid) from public;
grant  execute on function public.allocate(uuid, bigint, uuid, uuid) to authenticated;

create or replace function public.allocate_logistics(
  p_target_document_id uuid,
  p_amount_minor       bigint,
  p_payment_id         uuid
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
  v_target    public.logistics_documents;
  v_balance   bigint;
  v_available bigint;
  v_p_dir     text;
  v_id        uuid;
  v_found     boolean;
begin
  if v_org is null then
    raise exception 'allocate_logistics: no organisation for this account' using errcode = '28000';
  end if;
  if p_amount_minor <= 0 then
    raise exception 'allocate_logistics: amount must be positive' using errcode = '22003';
  end if;

  select * into v_target from public.logistics_documents
   where id = p_target_document_id and org_id = v_org and status = 'issued'
   for update;
  if v_target.id is null then
    raise exception 'allocate_logistics: target document not found or not issued' using errcode = 'P0002';
  end if;

  select balance_due_minor into v_balance
    from public.logistics_document_balances where document_id = p_target_document_id;
  if p_amount_minor > coalesce(v_balance, 0) then
    raise exception 'allocate_logistics: % exceeds the % still owed on this document', p_amount_minor, coalesce(v_balance, 0)
      using errcode = '22003';
  end if;

  -- Locked before reading "already allocated" — see header.
  select true, direction into v_found, v_p_dir
    from public.logistics_payments where id = p_payment_id and org_id = v_org
    for update;
  if v_found is null then
    raise exception 'allocate_logistics: payment not found in your organisation' using errcode = 'P0002';
  end if;

  select amount_minor - coalesce((select sum(amount_minor) from public.logistics_allocations where payment_id = p_payment_id), 0)
    into v_available
    from public.logistics_payments where id = p_payment_id;

  if (v_p_dir = 'in' and v_target.direction <> 'receivable')
     or (v_p_dir = 'out' and v_target.direction <> 'payable') then
    raise exception 'allocate_logistics: a % payment cannot be applied to a % document', v_p_dir, v_target.direction
      using errcode = '23514';
  end if;
  if p_amount_minor > v_available then
    raise exception 'allocate_logistics: % exceeds the % still unapplied on this payment', p_amount_minor, v_available
      using errcode = '22003';
  end if;

  insert into public.logistics_allocations (org_id, target_document_id, payment_id, amount_minor, created_by)
  values (v_org, p_target_document_id, p_payment_id, p_amount_minor, v_uid)
  returning id into v_id;

  return query select v_id;
end;
$$;

revoke execute on function public.allocate_logistics(uuid, bigint, uuid) from public;
grant  execute on function public.allocate_logistics(uuid, bigint, uuid) to authenticated;

create or replace function public.allocate_plastics(
  p_target_document_id uuid,
  p_amount_minor       bigint,
  p_payment_id         uuid
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
  v_target    public.plastics_documents;
  v_balance   bigint;
  v_available bigint;
  v_p_dir     text;
  v_id        uuid;
  v_found     boolean;
begin
  if v_org is null then
    raise exception 'allocate_plastics: no organisation for this account' using errcode = '28000';
  end if;
  if p_amount_minor <= 0 then
    raise exception 'allocate_plastics: amount must be positive' using errcode = '22003';
  end if;

  select * into v_target from public.plastics_documents
   where id = p_target_document_id and org_id = v_org and status = 'issued'
   for update;
  if v_target.id is null then
    raise exception 'allocate_plastics: target document not found or not issued' using errcode = 'P0002';
  end if;

  select balance_due_minor into v_balance
    from public.plastics_document_balances where document_id = p_target_document_id;
  if p_amount_minor > coalesce(v_balance, 0) then
    raise exception 'allocate_plastics: % exceeds the % still owed on this document', p_amount_minor, coalesce(v_balance, 0)
      using errcode = '22003';
  end if;

  -- Locked before reading "already allocated" — see header.
  select true, direction into v_found, v_p_dir
    from public.plastics_payments where id = p_payment_id and org_id = v_org
    for update;
  if v_found is null then
    raise exception 'allocate_plastics: payment not found in your organisation' using errcode = 'P0002';
  end if;

  select amount_minor - coalesce((select sum(amount_minor) from public.plastics_allocations where payment_id = p_payment_id), 0)
    into v_available
    from public.plastics_payments where id = p_payment_id;

  if (v_p_dir = 'in' and v_target.direction <> 'receivable')
     or (v_p_dir = 'out' and v_target.direction <> 'payable') then
    raise exception 'allocate_plastics: a % payment cannot be applied to a % document', v_p_dir, v_target.direction
      using errcode = '23514';
  end if;
  if p_amount_minor > v_available then
    raise exception 'allocate_plastics: % exceeds the % still unapplied on this payment', p_amount_minor, v_available
      using errcode = '22003';
  end if;

  insert into public.plastics_allocations (org_id, target_document_id, payment_id, amount_minor, created_by)
  values (v_org, p_target_document_id, p_payment_id, p_amount_minor, v_uid)
  returning id into v_id;

  return query select v_id;
end;
$$;

revoke execute on function public.allocate_plastics(uuid, bigint, uuid) from public;
grant  execute on function public.allocate_plastics(uuid, bigint, uuid) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- Restore the three function bodies from their prior migrations
-- (20260921000001_allocate_direction_guard.sql, 20260923000001, 20260924000001).
