-- ═══════════════════════════════════════════════════════════════════════════
-- 0020 — scrap, hospitality and wholesale, as rows
--
-- The product's whole claim is that an industry is DATA. Two templates have
-- shipped since 0012, which is not enough to test the claim — one of them is
-- "Something else". This adds three more, chosen because they stress the model
-- in different directions rather than because they are adjacent to freight:
--
--   scrap       buys from collectors and sells to processors, so it bills in
--               BOTH directions and prices by weight. The first template to
--               use `payable`, and the first to use quantity_rate.
--   hospitality sells small amounts to account customers and takes supplier
--               deliveries. Tests whether a business with many low-value
--               transactions fits a ledger built around invoices.
--   wholesale   sells goods by the case with a per-unit rate. Tests what
--               happens when one sale is many products.
--
-- Nothing here is code. No migration adds a column for any of them; they are
-- INSERTs into the same three tables freight uses, and the forms, the pricing,
-- the tax engine and the renderer are told nothing about them.
--
-- The rate fields here are `money`, not `number`, and that distinction is the
-- reason migration 0019 exists: a rate of 22 in a plain number field was read
-- by the pricing engine as 22 PAISE, so this very template would have billed
-- 1,840 kg at ₹22 as ₹404.80. See 0020.
--
-- Where a template needs something the schema cannot express, that is recorded
-- honestly in its description rather than worked around — see the notes on
-- wholesale and hospitality in docs/INDUSTRY-FIT.md.
--
-- Rollback: delete from public.industry_templates where key in
--   ('scrap', 'hospitality', 'wholesale'); the activity_types cascade.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.industry_templates (key, label, description, sort_order)
values
  ('scrap', 'Scrap & recycling',
   'Buy material by weight from collectors, sell it on by grade. Bills in both directions.', 1),
  ('hospitality', 'Café & hospitality',
   'Account customers, catering orders and supplier deliveries. Counter sales belong in a till.', 2),
  ('wholesale', 'Wholesale & distribution',
   'Goods sold by the case or the unit, priced per unit and billed to trade customers.', 3)
on conflict (key) do update
  set label = excluded.label,
      description = excluded.description,
      sort_order = excluded.sort_order;

-- Keep "Something else" last: it is the fallback, not a peer.
update public.industry_templates set sort_order = 90 where key = 'generic';

-- ───────────────────────────────────────────────────────────────────────────
-- System-owned activity types. org_id IS NULL, so the composite foreign key on
-- activities makes it structurally impossible to record work against one
-- without copying it into an organisation first.
-- ───────────────────────────────────────────────────────────────────────────
insert into public.activity_types
  (org_id, template_key, key, label_singular, label_plural, direction,
   pricing_strategy, pricing_config, dim1_field_key, sort_order)
values
  -- Scrap, both directions. The purchase is the first `payable` template:
  -- material bought in is money owed to a collector, not billed to them.
  (null, 'scrap', 'material_in', 'Purchase', 'Purchases', 'payable',
   'quantity_rate', '{"quantity_field": "net_weight_kg", "rate_field": "rate_per_kg"}'::jsonb,
   'material', 0),
  (null, 'scrap', 'material_out', 'Sale', 'Sales', 'receivable',
   'quantity_rate', '{"quantity_field": "net_weight_kg", "rate_field": "rate_per_kg"}'::jsonb,
   'material', 1),

  -- Hospitality. An order for an account customer, priced manually because a
  -- catering job is quoted rather than computed.
  (null, 'hospitality', 'order', 'Order', 'Orders', 'receivable',
   'manual', '{}'::jsonb, 'order_type', 0),

  -- Wholesale. One line per product, priced per unit.
  (null, 'wholesale', 'goods_out', 'Goods sold', 'Goods sold', 'receivable',
   'quantity_rate', '{"quantity_field": "units", "rate_field": "unit_price"}'::jsonb,
   'product', 0)
on conflict (key) where org_id is null do update
  set label_singular  = excluded.label_singular,
      label_plural    = excluded.label_plural,
      direction       = excluded.direction,
      pricing_strategy = excluded.pricing_strategy,
      pricing_config  = excluded.pricing_config,
      dim1_field_key  = excluded.dim1_field_key;

insert into public.activity_fields
  (activity_type_id, org_id, key, label, field_type, options, is_required,
   is_reportable, show_on_document, sort_order)
select t.id, null, f.key, f.label, f.field_type, f.options,
       f.is_required, f.is_reportable, f.show_on_document, f.sort_order
  from public.activity_types t
  join (values
    -- ── scrap: purchases ─────────────────────────────────────────────────
    ('material_in',  'material',      'Material',       'select',
       '["PET","HDPE","LDPE","PP","Mixed plastic","Cardboard","Ferrous","Aluminium","Copper"]'::jsonb,
                                                                    true,  true,  true,  0),
    ('material_in',  'grade',         'Grade',          'select',
       '["A","B","C","Mixed"]'::jsonb,                              false, false, true,  1),
    ('material_in',  'net_weight_kg', 'Net weight (kg)','number', '[]'::jsonb, true,  false, true,  2),
    ('material_in',  'rate_per_kg',   'Rate per kg',    'money',  '[]'::jsonb, true,  false, true,  3),
    ('material_in',  'ticket_no',     'Weighbridge slip','text',  '[]'::jsonb, false, false, true,  4),

    -- ── scrap: sales ─────────────────────────────────────────────────────
    ('material_out', 'material',      'Material',       'select',
       '["PET flake","HDPE flake","LDPE flake","PP granule","Baled cardboard","Ferrous","Aluminium","Copper"]'::jsonb,
                                                                    true,  true,  true,  0),
    ('material_out', 'grade',         'Grade',          'select',
       '["A","B","C","Mixed"]'::jsonb,                              false, false, true,  1),
    ('material_out', 'net_weight_kg', 'Net weight (kg)','number', '[]'::jsonb, true,  false, true,  2),
    ('material_out', 'rate_per_kg',   'Rate per kg',    'money',  '[]'::jsonb, true,  false, true,  3),
    ('material_out', 'vehicle_no',    'Vehicle no.',    'text',   '[]'::jsonb, false, false, true,  4),

    -- ── hospitality ──────────────────────────────────────────────────────
    ('order',        'order_type',    'Order type',     'select',
       '["Catering","Account tab","Function","Delivery"]'::jsonb,   true,  true,  true,  0),
    ('order',        'served_on',     'Served on',      'date',   '[]'::jsonb, false, false, true,  1),
    ('order',        'covers',        'Covers',         'number', '[]'::jsonb, false, false, true,  2),
    ('order',        'order_ref',     'Order reference','text',   '[]'::jsonb, false, false, true,  3),
    ('order',        'notes',         'Notes',          'long_text','[]'::jsonb, false, false, true,  4),

    -- ── wholesale ────────────────────────────────────────────────────────
    ('goods_out',    'product',       'Product',        'text',   '[]'::jsonb, true,  true,  true,  0),
    ('goods_out',    'sku',           'SKU',            'text',   '[]'::jsonb, false, false, true,  1),
    ('goods_out',    'units',         'Units',          'number', '[]'::jsonb, true,  false, true,  2),
    ('goods_out',    'unit_price',    'Price per unit', 'money',  '[]'::jsonb, true,  false, true,  3),
    ('goods_out',    'pack_size',     'Pack size',      'text',   '[]'::jsonb, false, false, true,  4)
  ) as f(type_key, key, label, field_type, options, is_required,
         is_reportable, show_on_document, sort_order)
    on f.type_key = t.key
 where t.org_id is null
on conflict (activity_type_id, key) do update
  set label            = excluded.label,
      field_type       = excluded.field_type,
      options          = excluded.options,
      is_required      = excluded.is_required,
      is_reportable    = excluded.is_reportable,
      show_on_document = excluded.show_on_document,
      sort_order       = excluded.sort_order;
