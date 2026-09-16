-- ═══════════════════════════════════════════════════════════════════════════
-- 01 · Extensions and shared helpers
--
-- pgcrypto for gen_random_uuid/gen_random_bytes, pg_trgm for fuzzy party
-- search (duplicate detection), set_updated_at() for the updated_at trigger,
-- and fiscal_year_code() for gapless per-period document numbering.
--
-- fiscal_year_code() is the multi-country generalisation of LedgerFlow's
-- fy_code(), which hardcoded 1 April. Moonbook serves organisations whose
-- financial year starts in any month, so the start month is an argument read
-- from organisations.fiscal_year_start_month rather than baked into the
-- function.
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm  with schema extensions;

-- ───────────────────────────────────────────────────────────────────────────
-- fiscal_year_code: a 4-character key identifying the financial year a date
-- falls in, for an organisation whose year starts in p_start_month.
--
--   start_month = 4 (India)      2026-09-15 → '2627'   FY 2026-27
--                                 2027-02-10 → '2627'   still FY 2026-27
--   start_month = 7 (Australia)  2026-03-01 → '2526'   FY 2025-26
--   start_month = 1 (calendar)   2026-09-15 → '2026'   the year itself
--
-- A year that spans two calendar years renders as two 2-digit halves; a
-- calendar year renders as its own 4 digits. Both are 4 characters, so the
-- document-number format (PREFIX-XXXX-NNNNNN) is identical either way and the
-- `^[0-9]{4}$` shape check on document_sequences.period_key holds for both.
-- Rendering a calendar year as '2627' would put the wrong year on a
-- calendar-year org's invoices.
--
-- IMMUTABLE (extract() arithmetic, not to_char()) so it stays usable in an
-- index or a generated column. p_start_month is NOT range-checked here — an
-- immutable SQL function has no good way to raise — so the 1..12 constraint
-- lives on organisations.fiscal_year_start_month, where a bad value can never
-- be stored in the first place.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.fiscal_year_code(p_date date, p_start_month integer)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_start_month = 1 then
      -- Calendar year: the year the date is in, in full.
      to_char(p_date, 'YYYY')
    else
      -- Spans two calendar years: last two digits of each, concatenated.
      lpad((( extract(year from p_date)::int
              - case when extract(month from p_date)::int < p_start_month then 1 else 0 end
            ) % 100)::text, 2, '0')
      ||
      lpad((( extract(year from p_date)::int
              - case when extract(month from p_date)::int < p_start_month then 1 else 0 end
              + 1
            ) % 100)::text, 2, '0')
  end
$$;

comment on function public.fiscal_year_code(date, integer) is
  'The 4-character financial-year key a date falls in, for a year starting in p_start_month. Spanning years render as two 2-digit halves (2627); calendar years render in full (2026).';

-- ───────────────────────────────────────────────────────────────────────────
-- set_updated_at: the updated_at trigger function.
--
-- Per CONVENTIONS.md §8, this is attached to mutable tables ONLY. Append-only
-- tables (audit_events, allocations, payments, document_taxes) carry
-- created_at alone, and their immutability is enforced by the absence of an
-- UPDATE policy and grant rather than by a trigger.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger function maintaining updated_at. Attached to mutable tables only — see CONVENTIONS.md section 8.';

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.set_updated_at();
-- drop function if exists public.fiscal_year_code(date, integer);
