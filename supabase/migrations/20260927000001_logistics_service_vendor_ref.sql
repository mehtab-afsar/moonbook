-- Trips & charges becomes Services, receivable-only.
--
-- Logistics activities used to hold two shapes in one table: a trip
-- (receivable, billed to a client) and a "vendor charge" (payable, what a
-- vendor billed the business). The payable shape is retired here — a vendor
-- charge is no longer something a user pre-logs as its own activity before
-- paying it; it's created on the spot, from the vendor's own invoice number,
-- at the moment of paying them (see VendorPaymentForm). What stays is the
-- receivable "service" (a trip, unchanged in every other respect) plus a new
-- purely-internal pointer to which vendor is doing the work — never printed
-- on the client's invoice, since nothing that renders one reads this column.
--
-- record_logistics_activity is NOT redefined here — this column was added
-- alongside distance_km days later, and neither had shipped anywhere yet, so
-- the two additions are picked up together in one place by
-- 20260930000001_logistics_distance_km.sql's own definition, rather than
-- this migration installing a 14-argument version that the next one would
-- immediately replace with a 15-argument one.

alter table public.logistics_activities
  add column if not exists assigned_vendor_id uuid references public.parties(id) on delete set null;

create index if not exists logistics_activities_assigned_vendor_idx
  on public.logistics_activities (assigned_vendor_id) where assigned_vendor_id is not null;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop index if exists public.logistics_activities_assigned_vendor_idx;
-- alter table public.logistics_activities drop column if exists assigned_vendor_id;
