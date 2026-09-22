-- Vendor payout details.
--
-- A party has no stored vendor/client type (see 20260916000003_parties.sql) —
-- role is still read from transaction direction, not this migration. What's
-- added here is just the extra information a business needs on hand for
-- whichever of its parties it pays: where to send the money. A pure client
-- never needs this; the UI shows it only in vendor context, but nothing here
-- enforces that — these are ordinary optional columns, same as email/phone.

alter table public.parties
  add column if not exists payout_bank_name    text,
  add column if not exists payout_account_no   text,
  add column if not exists payout_ifsc_or_routing text,
  add column if not exists payout_upi_id       text;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- alter table public.parties
--   drop column if exists payout_bank_name,
--   drop column if exists payout_account_no,
--   drop column if exists payout_ifsc_or_routing,
--   drop column if exists payout_upi_id;
