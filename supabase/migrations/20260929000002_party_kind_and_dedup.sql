-- A party's vendor/client role was deliberately never stored — read purely
-- from which direction its documents have gone (20260916000003_parties.sql).
-- That's still true for BILLING: nothing here restricts which direction a
-- document can be raised against a party. But it created a real UX gap: a
-- brand-new party has no document history yet, so it cannot be placed in
-- either tab of the Parties list, or offered in an "assigned vendor" picker,
-- until after its first bill — a chicken-and-egg problem users hit directly.
--
-- `kind` fixes that without reversing the original decision: it's which tab
-- you ADDED a party from (a UI convenience, defaulting the list they land
-- in), never a constraint on which direction they can later be billed.
-- NULL means "added before this existed" or "unclassified" — the UI falls
-- back to the same computed-role logic it always used for those.

alter table public.parties
  add column if not exists kind text
  constraint parties_kind_chk check (kind is null or kind in ('client', 'vendor'));

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- alter table public.parties drop constraint if exists parties_kind_chk;
-- alter table public.parties drop column if exists kind;
