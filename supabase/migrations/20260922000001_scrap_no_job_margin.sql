-- ═══════════════════════════════════════════════════════════════════════════
-- 23 · Scrap does not use job margin
--
-- Every activity_types row defaults uses_job_margin to true, and scrap's
-- material_in/material_out seed (20260916000020) never overrode it. But
-- docs/INDUSTRY-FIT.md says outright that scrap margin is a PERIOD figure,
-- not a per-load one — 500 kg bought Monday does not map to 2 t sold
-- Friday — so surfacing a per-activity "margin" for scrap would print
-- fiction. This is what the flag exists to prevent; it was simply never set.
-- ═══════════════════════════════════════════════════════════════════════════

update public.activity_types
   set uses_job_margin = false
 where org_id is null
   and template_key = 'scrap'
   and key in ('material_in', 'material_out');

-- Existing organisations that already copied scrap in before this fix get the
-- correction too — this is a data-definition fix, not a per-org preference,
-- the same reasoning apply_industry_template itself uses for template rows
-- an org has not customised.
update public.activity_types
   set uses_job_margin = false
 where org_id is not null
   and template_key = 'scrap'
   and key in ('material_in', 'material_out');

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- update public.activity_types set uses_job_margin = true
--   where template_key = 'scrap' and key in ('material_in', 'material_out');
