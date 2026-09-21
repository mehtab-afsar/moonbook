-- ═══════════════════════════════════════════════════════════════════════════
-- 22 · Freight gets a payable side: vendor_charge
--
-- freight has always been receivable-only — trips billed to a broker or
-- consignee. That leaves no way to record what the trip actually cost: the
-- market vehicle you hired, or a broker's own cut, needs to be a payable
-- so it becomes a bill and a tracked vendor payment, the same way scrap's
-- material_in already does for a purchase.
--
-- Deliberately manual pricing (typed once, not weight/unit derived) — a
-- vendor's charge for a trip is whatever their invoice says, not a formula.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.activity_types
  (org_id, template_key, key, label_singular, label_plural, direction, pricing_strategy, pricing_config, dim1_field_key, sort_order)
values
  (null, 'freight', 'vendor_charge', 'Vendor charge', 'Vendor charges', 'payable', 'manual', '{}'::jsonb, null, 1)
on conflict (key) where org_id is null do update
  set label_singular = excluded.label_singular,
      label_plural   = excluded.label_plural,
      direction      = excluded.direction,
      pricing_strategy = excluded.pricing_strategy,
      dim1_field_key = excluded.dim1_field_key,
      sort_order     = excluded.sort_order;

insert into public.activity_fields
  (activity_type_id, org_id, key, label, field_type, options, is_required, is_reportable, show_on_document, sort_order)
select t.id, null, f.key, f.label, f.field_type, f.options, f.is_required, f.is_reportable, f.show_on_document, f.sort_order
  from public.activity_types t
  join (values
    ('vendor_charge', 'vendor_ref', 'Vendor invoice / LR no.', 'text', '[]'::jsonb, false, false, true, 0),
    ('vendor_charge', 'notes',      'Notes',                   'long_text', '[]'::jsonb, false, false, true, 1)
  ) as f(type_key, key, label, field_type, options, is_required, is_reportable, show_on_document, sort_order)
    on f.type_key = t.key
 where t.org_id is null
on conflict (activity_type_id, key) do update
  set label = excluded.label, options = excluded.options, sort_order = excluded.sort_order;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- delete from public.activity_fields where activity_type_id in
--   (select id from public.activity_types where org_id is null and key = 'vendor_charge');
-- delete from public.activity_types where org_id is null and key = 'vendor_charge';
