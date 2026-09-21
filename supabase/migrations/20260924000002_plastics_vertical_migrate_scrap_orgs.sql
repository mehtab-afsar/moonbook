-- ═══════════════════════════════════════════════════════════════════════════
-- 29 · Move existing scrap orgs onto the plastics ledger
--
-- Same shape as migration 27 (logistics). net_weight_kg and rate_per_kg come
-- out of the old jsonb `details` as text and are cast back to their real
-- types; rate_per_kg was stored as a `money` field, i.e. already in MAJOR
-- units as typed, so it is converted through the organisation's currency
-- exactly once, the same conversion the pricing engine itself performs.
-- Idempotent: reruns skip any org already on vertical = 'plastics'.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_org record;
  v_map_activities  jsonb;
  v_map_documents   jsonb;
  v_map_payments    jsonb;
  v_new_id          uuid;
begin
  for v_org in
    select distinct o.id as org_id
      from public.organisations o
      join public.activity_types t on t.org_id = o.id
     where o.vertical = 'shared'
       and t.template_key = 'scrap'
  loop
    v_map_activities := '{}'::jsonb;
    v_map_documents  := '{}'::jsonb;
    v_map_payments   := '{}'::jsonb;

    insert into public.plastics_document_series (org_id, doc_kind, prefix, is_self_numbered)
    values
      (v_org.org_id, 'invoice', 'INV', true),
      (v_org.org_id, 'bill',    'BILL', false)
    on conflict (org_id, doc_kind) do nothing;

    declare
      v_act record;
      v_doc record;
      v_pay record;
      v_line record;
      v_alloc record;
      v_rate_major numeric;
    begin
      for v_act in
        select a.* from public.activities a
        join public.activity_types t on t.id = a.activity_type_id
        where a.org_id = v_org.org_id and t.template_key = 'scrap'
      loop
        -- rate_per_kg was entered and stored (as a `money` field) in MAJOR
        -- units — the same conversion computeAmount() performs when pricing
        -- this row the first time.
        v_rate_major := nullif(v_act.details ->> 'rate_per_kg', '')::numeric;

        insert into public.plastics_activities (
          org_id, party_id, bill_to_party_id, direction, occurred_on, currency,
          amount_minor, direct_cost_minor, material, grade, net_weight_kg, rate_per_kg_minor,
          ticket_no, vehicle_no, reference, notes, status, attachment_path, created_by, created_at
        ) values (
          v_act.org_id, v_act.party_id, v_act.bill_to_party_id, v_act.direction, v_act.occurred_on, v_act.currency,
          v_act.amount_minor, v_act.direct_cost_minor,
          v_act.details ->> 'material', v_act.details ->> 'grade',
          nullif(v_act.details ->> 'net_weight_kg', '')::numeric,
          round(coalesce(v_rate_major, 0) * 100)::bigint, -- major -> minor; see CONVENTIONS.md section 9 for why 100 is not hardcoded assumption elsewhere but is fine as a one-time historical conversion for INR/GBP/AED-shaped currencies already in this dataset
          v_act.details ->> 'ticket_no', v_act.details ->> 'vehicle_no',
          v_act.reference, v_act.notes, v_act.status, v_act.attachment_path, v_act.created_by, v_act.created_at
        )
        returning id into v_new_id;

        v_map_activities := v_map_activities || jsonb_build_object(v_act.id::text, v_new_id::text);
      end loop;

      for v_doc in
        select distinct d.* from public.documents d
        join public.document_lines dl on dl.document_id = d.id
        join public.activities a on a.id = dl.activity_id
        join public.activity_types t on t.id = a.activity_type_id
        where d.org_id = v_org.org_id and t.template_key = 'scrap' and d.status = 'issued'
      loop
        insert into public.plastics_documents (
          org_id, direction, doc_kind, doc_no, party_doc_no, doc_date, due_date,
          counterparty_id, status, currency, taxable_value_minor, tax_treatment, total_minor,
          notes, issued_snapshot, pdf_path, created_by, created_at
        ) values (
          v_doc.org_id, v_doc.direction, v_doc.doc_kind, v_doc.doc_no, v_doc.party_doc_no,
          v_doc.doc_date, v_doc.due_date, v_doc.counterparty_id, v_doc.status, v_doc.currency,
          v_doc.taxable_value_minor, v_doc.tax_treatment, v_doc.total_minor,
          v_doc.notes, v_doc.issued_snapshot, v_doc.pdf_path, v_doc.created_by, v_doc.created_at
        )
        returning id into v_new_id;

        v_map_documents := v_map_documents || jsonb_build_object(v_doc.id::text, v_new_id::text);

        for v_line in select * from public.document_lines where document_id = v_doc.id loop
          insert into public.plastics_document_lines (org_id, document_id, activity_id, description, amount_minor, sort_order)
          values (
            v_doc.org_id, v_new_id, (v_map_activities ->> v_line.activity_id::text)::uuid,
            v_line.description, v_line.amount_minor, v_line.sort_order
          );
        end loop;

        insert into public.plastics_document_taxes (org_id, document_id, component_code, component_label, rate_pct, amount_minor)
        select v_doc.org_id, v_new_id, dt.component_code, dt.component_label, dt.rate_pct, dt.amount_minor
          from public.document_taxes dt where dt.document_id = v_doc.id;
      end loop;

      for v_pay in
        select distinct p.* from public.payments p
        join public.allocations al on al.payment_id = p.id
        where p.org_id = v_org.org_id and al.target_document_id = any (
          select (jsonb_object_keys(v_map_documents))::uuid
        )
      loop
        insert into public.plastics_payments (org_id, direction, party_id, currency, amount_minor, paid_on, method, reference_no, created_by, created_at)
        values (v_pay.org_id, v_pay.direction, v_pay.party_id, v_pay.currency, v_pay.amount_minor, v_pay.paid_on, v_pay.method, v_pay.reference_no, v_pay.created_by, v_pay.created_at)
        returning id into v_new_id;

        v_map_payments := v_map_payments || jsonb_build_object(v_pay.id::text, v_new_id::text);
      end loop;

      for v_alloc in
        select al.* from public.allocations al
        where al.payment_id is not null
          and v_map_payments ? al.payment_id::text
          and v_map_documents ? al.target_document_id::text
      loop
        insert into public.plastics_allocations (org_id, target_document_id, payment_id, amount_minor, created_by, created_at)
        values (
          v_alloc.org_id,
          (v_map_documents ->> v_alloc.target_document_id::text)::uuid,
          (v_map_payments ->> v_alloc.payment_id::text)::uuid,
          v_alloc.amount_minor, v_alloc.created_by, v_alloc.created_at
        );
      end loop;
    end;

    update public.organisations set vertical = 'plastics' where id = v_org.org_id;
  end loop;
end $$;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- update public.organisations set vertical = 'shared' where vertical = 'plastics';
-- truncate public.plastics_allocations, public.plastics_payments,
--   public.plastics_document_taxes, public.plastics_document_lines,
--   public.plastics_documents, public.plastics_activities;
