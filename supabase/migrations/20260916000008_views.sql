-- ═══════════════════════════════════════════════════════════════════════════
-- 08 · Live balance views
--
-- Never a stored counter. Every figure here is recomputed from invoices,
-- payments and credit notes on each read, so recording a payment cannot leave
-- a stale number behind — there is no number to leave stale.
--
-- SECURITY INVOKER IS NOT OPTIONAL. A view created by the migration role
-- (which has BYPASSRLS) otherwise runs with the VIEW OWNER's privileges, not
-- the caller's, and would hand every organisation's balances to every signed-
-- in user. `security_invoker = true` makes the view evaluate RLS as the actual
-- caller, exactly as querying the underlying tables would.
--
-- Note for the API layer: PostgREST can only embed across a real foreign key,
-- so `.select("...view(...)")` against these FAILS with PGRST200 rather than
-- degrading — a route that ignores `error` silently returns an empty list.
-- Fetch a view separately and merge. This cost LedgerFlow a production bug.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- document_balances
--
-- Restricted to invoices and bills: credit and debit notes are SOURCES of
-- offsets, never targets, and including them would double-count.
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.document_balances
with (security_invoker = true) as
select
  d.id            as document_id,
  d.org_id,
  d.direction,
  d.doc_kind,
  d.counterparty_id,
  d.doc_no,
  d.party_doc_no,
  d.doc_date,
  d.due_date,
  d.currency,
  d.total_minor,
  coalesce(p.settled_minor, 0)  as settled_minor,
  coalesce(c.credited_minor, 0) as credited_minor,
  d.total_minor
    - coalesce(p.settled_minor, 0)
    - coalesce(c.credited_minor, 0) as balance_due_minor
from public.documents d
left join (
  select target_document_id, sum(amount_minor) as settled_minor
    from public.allocations
   where payment_id is not null
   group by target_document_id
) p on p.target_document_id = d.id
left join (
  select target_document_id, sum(amount_minor) as credited_minor
    from public.allocations
   where credit_document_id is not null
   group by target_document_id
) c on c.target_document_id = d.id
where d.status = 'issued'
  and d.doc_kind in ('invoice', 'bill');

comment on view public.document_balances is
  'Live per-document balance: total minus applied payments minus applied credit notes. Recomputed on every read — never a stored counter.';

-- ───────────────────────────────────────────────────────────────────────────
-- party_outstanding
--
-- Grouped by direction AND currency, deliberately. Netting what a party owes
-- you against what you owe them, or blending two currencies into one total,
-- both produce a number that looks authoritative and is meaningless. Show
-- "they owe you X / you owe them Y" and make netting an explicit action that
-- creates a real document.
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.party_outstanding
with (security_invoker = true) as
select
  counterparty_id as party_id,
  org_id,
  direction,
  currency,
  count(*) filter (where balance_due_minor > 0)                            as documents_outstanding,
  coalesce(sum(balance_due_minor) filter (where balance_due_minor > 0), 0) as amount_outstanding_minor,
  count(*) filter (where balance_due_minor > 0 and due_date < current_date) as documents_overdue,
  coalesce(sum(balance_due_minor) filter (where balance_due_minor > 0 and due_date < current_date), 0)
                                                                           as amount_overdue_minor
from public.document_balances
group by counterparty_id, org_id, direction, currency;

comment on view public.party_outstanding is
  'Per-party rollup of document_balances, split by direction and currency. Never nets the two directions and never blends currencies.';

-- ───────────────────────────────────────────────────────────────────────────
-- credit_balances — how much of a credit/debit note is still unapplied.
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.credit_balances
with (security_invoker = true) as
select
  d.id      as document_id,
  d.org_id,
  d.direction,
  d.doc_kind,
  d.counterparty_id,
  d.doc_no,
  d.currency,
  d.total_minor,
  coalesce(a.applied_minor, 0)                as applied_minor,
  d.total_minor - coalesce(a.applied_minor, 0) as unapplied_minor
from public.documents d
left join (
  select credit_document_id, sum(amount_minor) as applied_minor
    from public.allocations
   where credit_document_id is not null
   group by credit_document_id
) a on a.credit_document_id = d.id
where d.status = 'issued'
  and d.doc_kind in ('credit_note', 'debit_note');

comment on view public.credit_balances is
  'Unapplied balance of each issued credit or debit note — what is left to set against a future document.';

-- ───────────────────────────────────────────────────────────────────────────
-- payment_balances — how much of a payment is still unapplied.
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.payment_balances
with (security_invoker = true) as
select
  p.id      as payment_id,
  p.org_id,
  p.direction,
  p.party_id,
  p.currency,
  p.paid_on,
  p.amount_minor,
  coalesce(a.applied_minor, 0)                as applied_minor,
  p.amount_minor - coalesce(a.applied_minor, 0) as unapplied_minor
from public.payments p
left join (
  select payment_id, sum(amount_minor) as applied_minor
    from public.allocations
   where payment_id is not null
   group by payment_id
) a on a.payment_id = p.id;

comment on view public.payment_balances is
  'Unapplied balance of each payment. Money received that has not been matched to a document stays visible here rather than being force-matched to make a number disappear.';

-- ───────────────────────────────────────────────────────────────────────────
-- party_ready_to_bill — the mirror of party_outstanding: not "who owes me"
-- but "who should I invoice next". Grouped by the party that will actually be
-- billed, which is why bill_to_party_id exists on the activity.
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.party_ready_to_bill
with (security_invoker = true) as
select
  coalesce(bill_to_party_id, party_id) as party_id,
  org_id,
  direction,
  currency,
  count(*)                            as pending_count,
  coalesce(sum(amount_minor), 0)      as pending_amount_minor
from public.activities
where status = 'completed'
group by coalesce(bill_to_party_id, party_id), org_id, direction, currency;

comment on view public.party_ready_to_bill is
  'Completed, not-yet-billed activities per party — grouped by who will be billed, not by who the work was done for.';

-- ───────────────────────────────────────────────────────────────────────────
-- activity_margin — revenue against direct cost, per activity.
--
-- Only meaningful where one activity IS one job. uses_job_margin is false for
-- trading businesses, where a purchase does not map to a sale and margin is a
-- period-level figure; the flag is carried here so a report can tell the
-- difference rather than printing fiction.
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.activity_margin
with (security_invoker = true) as
select
  a.id       as activity_id,
  a.org_id,
  a.activity_type_id,
  a.party_id,
  a.direction,
  a.currency,
  a.occurred_on,
  a.status,
  t.uses_job_margin,
  a.amount_minor                                   as revenue_minor,
  a.direct_cost_minor,
  a.amount_minor - coalesce(a.direct_cost_minor, 0) as margin_minor
from public.activities a
join public.activity_types t on t.id = a.activity_type_id;

comment on view public.activity_margin is
  'Per-activity revenue, direct cost and margin. uses_job_margin says whether that margin means anything for this activity type.';

grant select on public.document_balances   to authenticated;
grant select on public.party_outstanding   to authenticated;
grant select on public.credit_balances     to authenticated;
grant select on public.payment_balances    to authenticated;
grant select on public.party_ready_to_bill to authenticated;
grant select on public.activity_margin     to authenticated;

revoke all on public.document_balances   from anon;
revoke all on public.party_outstanding   from anon;
revoke all on public.credit_balances     from anon;
revoke all on public.payment_balances    from anon;
revoke all on public.party_ready_to_bill from anon;
revoke all on public.activity_margin     from anon;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop view if exists public.activity_margin;
-- drop view if exists public.party_ready_to_bill;
-- drop view if exists public.payment_balances;
-- drop view if exists public.credit_balances;
-- drop view if exists public.party_outstanding;
-- drop view if exists public.document_balances;
