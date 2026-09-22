-- ═══════════════════════════════════════════════════════════════════════════
-- Per-line tax rates.
--
-- Until now, `computeTax()` took ONE rate for the whole document — fine for
-- freight (one service, one rate) but wrong for wholesale, which routinely
-- mixes rates on one delivery (5% oil, 18% groceries). `document_taxes`
-- already supports this with zero schema change: it's one row per component,
-- and nothing stops two CGST/SGST pairs at different rates coexisting on the
-- same document. What was actually missing was a RATE to attach to each
-- LINE, so the API route (app/api/documents/route.ts) can group taxable
-- value by rate and call computeTax() once per group instead of once total.
--
-- Nullable, not required: null means "use the organisation's own default
-- rate", so every existing activity, free line and document keeps behaving
-- exactly as it does today. This is additive, not a behavioural change for
-- anyone who never sets it.
--
-- Lives on `activities` (set at record time, alongside direct_cost_minor —
-- the other optional per-line override already there) and mirrored onto
-- `document_lines` at billing time, for the same reason rate_minor and
-- discount_minor are stored per line: an audit trail of what was actually
-- charged, not just the final total.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.activities
  add column if not exists tax_rate_pct numeric(5,2);

alter table public.document_lines
  add column if not exists tax_rate_pct numeric(5,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'activities_tax_rate_chk') then
    alter table public.activities
      add constraint activities_tax_rate_chk
      check (tax_rate_pct is null or (tax_rate_pct >= 0 and tax_rate_pct <= 100));
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'document_lines_tax_rate_chk') then
    alter table public.document_lines
      add constraint document_lines_tax_rate_chk
      check (tax_rate_pct is null or (tax_rate_pct >= 0 and tax_rate_pct <= 100));
  end if;
end $$;

comment on column public.activities.tax_rate_pct is
  'Overrides the organisation''s default tax rate for this one line, when set. Null means "use the org default" — see 20261001000005_per_line_tax_rate.sql.';
comment on column public.document_lines.tax_rate_pct is
  'The rate actually applied to this line at billing time, mirrored from the activity (or the free line payload) that produced it. Cosmetic/audit only — document_taxes already carries the computed breakdown.';

-- ───────────────────────────────────────────────────────────────────────────
-- record_activity / update_activity: same signature plus one new trailing
-- parameter. `create or replace` cannot add a parameter in place — see
-- 20260930000001_logistics_distance_km.sql's own header for why — so the old
-- 12-argument version is dropped first.
-- ───────────────────────────────────────────────────────────────────────────
drop function if exists public.record_activity(
  uuid, uuid, date, bigint, uuid, text, jsonb, bigint, date, date, text, text
);

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
  p_status           text default 'completed',
  p_tax_rate_pct     numeric default null
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
  if p_tax_rate_pct is not null and (p_tax_rate_pct < 0 or p_tax_rate_pct > 100) then
    raise exception 'record_activity: tax rate must be between 0 and 100' using errcode = '22003';
  end if;

  select base_currency into v_currency from public.organisations where id = v_org;

  insert into public.activities (
    org_id, activity_type_id, party_id, bill_to_party_id, direction, currency,
    occurred_on, period_start, period_end, amount_minor, direct_cost_minor,
    reference, status, dim1_key, dim1_value, details, notes, tax_rate_pct, created_by
  ) values (
    v_org, p_activity_type_id, p_party_id, p_bill_to_party_id, v_direction, v_currency,
    p_occurred_on, p_period_start, p_period_end, p_amount_minor, p_direct_cost_minor,
    nullif(p_reference, ''), p_status,
    v_dim1_key,
    case when v_dim1_key is not null then p_details ->> v_dim1_key end,
    coalesce(p_details, '{}'::jsonb), nullif(p_notes, ''), p_tax_rate_pct, v_uid
  )
  returning id into v_id;

  return query select v_id;
end;
$$;

comment on function public.record_activity(uuid, uuid, date, bigint, uuid, text, jsonb, bigint, date, date, text, text, numeric) is
  'Records a unit of work. Since 20261001000005, accepts an optional per-line tax rate override (null = use the organisation default).';

revoke execute on function public.record_activity(uuid, uuid, date, bigint, uuid, text, jsonb, bigint, date, date, text, text, numeric) from public;
grant  execute on function public.record_activity(uuid, uuid, date, bigint, uuid, text, jsonb, bigint, date, date, text, text, numeric) to authenticated;

drop function if exists public.update_activity(
  uuid, uuid, date, bigint, uuid, text, jsonb, bigint, date, date, text, text
);

create or replace function public.update_activity(
  p_activity_id      uuid,
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
  p_status           text default 'completed',
  p_tax_rate_pct     numeric default null
)
returns table (activity_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org      uuid := (select public.current_org_id());
  v_uid      uuid := auth.uid();
  v_before   jsonb;
  v_status   text;
  v_type_id  uuid;
  v_dim1_key text;
begin
  if v_org is null then
    raise exception 'update_activity: no organisation for this account' using errcode = '28000';
  end if;

  select to_jsonb(a), a.status, a.activity_type_id
    into v_before, v_status, v_type_id
    from public.activities a
   where a.id = p_activity_id and a.org_id = v_org
     for update;

  if v_before is null then
    raise exception 'update_activity: activity not found in your organisation' using errcode = 'P0002';
  end if;

  if v_status = 'invoiced' then
    raise exception 'update_activity: this work has already been invoiced — cancel the document or raise a credit note instead'
      using errcode = '23514';
  end if;

  if not exists (select 1 from public.parties where id = p_party_id and org_id = v_org) then
    raise exception 'update_activity: party not found in your organisation' using errcode = 'P0002';
  end if;
  if p_bill_to_party_id is not null
     and not exists (select 1 from public.parties where id = p_bill_to_party_id and org_id = v_org) then
    raise exception 'update_activity: bill-to party not found in your organisation' using errcode = 'P0002';
  end if;

  if p_amount_minor < 0 then
    raise exception 'update_activity: amount cannot be negative' using errcode = '22003';
  end if;
  if p_tax_rate_pct is not null and (p_tax_rate_pct < 0 or p_tax_rate_pct > 100) then
    raise exception 'update_activity: tax rate must be between 0 and 100' using errcode = '22003';
  end if;

  if p_status not in ('pending', 'completed', 'cancelled') then
    raise exception 'update_activity: status must be pending, completed or cancelled' using errcode = '22023';
  end if;

  select t.dim1_field_key into v_dim1_key
    from public.activity_types t where t.id = v_type_id;

  update public.activities a
     set party_id          = p_party_id,
         bill_to_party_id  = p_bill_to_party_id,
         occurred_on       = p_occurred_on,
         period_start      = p_period_start,
         period_end        = p_period_end,
         amount_minor      = p_amount_minor,
         direct_cost_minor = p_direct_cost_minor,
         reference         = nullif(p_reference, ''),
         status            = p_status,
         dim1_key          = v_dim1_key,
         dim1_value        = case when v_dim1_key is not null then p_details ->> v_dim1_key end,
         details           = coalesce(p_details, '{}'::jsonb),
         notes             = nullif(p_notes, ''),
         tax_rate_pct      = p_tax_rate_pct,
         updated_at        = now()
   where a.id = p_activity_id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, before, after)
  select v_org, v_uid, 'activity.updated', 'activity', p_activity_id, v_before, to_jsonb(a)
    from public.activities a where a.id = p_activity_id;

  return query select p_activity_id;
end;
$$;

comment on function public.update_activity(uuid, uuid, date, bigint, uuid, text, jsonb, bigint, date, date, text, text, numeric) is
  'Corrects an unbilled activity. Since 20261001000005, accepts the same optional per-line tax rate override as record_activity.';

revoke execute on function public.update_activity(uuid, uuid, date, bigint, uuid, text, jsonb, bigint, date, date, text, text, numeric) from public;
grant  execute on function public.update_activity(uuid, uuid, date, bigint, uuid, text, jsonb, bigint, date, date, text, text, numeric) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- issue_document: same 14-argument signature, body only — copies each line's
-- effective tax_rate_pct (from the activity it bills, or from the free-line
-- payload) onto document_lines. No signature change: p_free_lines is jsonb
-- already, so a new key in it needs no new parameter.
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

  if v_self then
    v_doc_no := public.next_doc_number(p_doc_kind, p_doc_date);
  elsif nullif(p_party_doc_no, '') is null then
    raise exception 'issue_document: the % series is not self-numbered, so the counterparty''s document number is required', p_doc_kind
      using errcode = '22004';
  end if;

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

  -- One line per billed activity — tax_rate_pct copied straight from the
  -- activity, so the line records the rate that was actually used to compute
  -- this document's tax, not just the amount.
  if array_length(p_activity_ids, 1) > 0 then
    foreach v_activity in array p_activity_ids loop
      insert into public.document_lines (org_id, document_id, activity_id, description, amount_minor, tax_rate_pct, sort_order)
      select v_org, v_doc_id, a.id,
             coalesce(t.label_singular, 'Item') ||
               case when a.reference is not null then ' — ' || a.reference else '' end,
             a.amount_minor,
             a.tax_rate_pct,
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
      rate_minor, discount_minor, amount_minor, tax_rate_pct
      , sort_order
    ) values (
      v_org, v_doc_id, v_line->>'description', v_line->>'hsn_sac',
      (v_line->>'quantity')::numeric, v_line->>'unit',
      (v_line->>'rate_minor')::bigint,
      coalesce((v_line->>'discount_minor')::bigint, 0),
      (v_line->>'amount_minor')::bigint,
      (v_line->>'tax_rate_pct')::numeric,
      v_sort
    );

    v_sort := v_sort + 1;
  end loop;

  -- Tax components, exactly as lib/tax/ computed them — possibly several
  -- rate groups' worth, merged and re-sorted by the caller before this.
  for v_tax in select * from jsonb_array_elements(coalesce(p_taxes, '[]'::jsonb)) loop
    insert into public.document_taxes (
      org_id, document_id, component_code, component_label, rate_pct, amount_minor, sort_order
    ) values (
      v_org, v_doc_id, v_tax->>'component_code', v_tax->>'component_label',
      (v_tax->>'rate_pct')::numeric, (v_tax->>'amount_minor')::bigint,
      coalesce((v_tax->>'sort_order')::integer, 0)
    );
  end loop;

  select jsonb_build_object(
           'document',     to_jsonb(d),
           'lines',        coalesce((
                             select jsonb_agg(
                                      to_jsonb(l) || jsonb_build_object(
                                        'printable_details', coalesce(pd.items, '[]'::jsonb))
                                      order by l.sort_order, l.id)
                               from public.document_lines l
                               left join lateral (
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

comment on function public.issue_document(text, uuid, date, bigint, bigint, jsonb, uuid[], jsonb, text, date, uuid, text, text, text) is
  'Owner-only since 0017. Creates and issues a document with its lines and tax components, locking against double-billing, freezing an issued_snapshot, and logging document.issued. Tax is computed in lib/tax/ and passed in, never recomputed here — since 20261001000005, possibly as several rate groups'' worth of components. Since 0021 lines carry the order they were chosen in; since 20261001000005 each line also carries the rate that was applied to it.';

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- Re-applying the prior versions of these three functions from their
-- original migrations reverses the body changes; the two DROPs above would
-- need their 13-argument counterparts dropped in turn, then the columns:
-- alter table public.document_lines drop column if exists tax_rate_pct;
-- alter table public.activities drop column if exists tax_rate_pct;
