-- ═══════════════════════════════════════════════════════════════════════════
-- 11 · service_role grants
--
-- Supabase's default privileges give a newly created table only REFERENCES,
-- TRIGGER and TRUNCATE to service_role — no SELECT, INSERT, UPDATE or DELETE.
-- Every earlier migration grants explicitly to `authenticated` and revokes
-- from `anon`, and says nothing about service_role, so the server-only paths
-- that legitimately need it — CSV import, seeding, support tooling, a
-- background job — currently get "permission denied".
--
-- Granting it here, once and visibly, rather than scattering a third grant
-- line through every migration.
--
-- WHAT THIS MEANS FOR SAFETY. service_role bypasses RLS entirely; that is its
-- purpose and why the key is server-only. So on this path the tenancy fence is
-- gone and the ONLY thing standing between a bad import and a corrupted
-- `details` column is the validation trigger from migration 10. That is
-- precisely the argument for having the trigger rather than relying on
-- "everything goes through an RPC" — this is the write path that doesn't.
--
-- document_sequences is deliberately EXCLUDED. Gapless numbering is allocated
-- only by next_doc_number(), which is SECURITY DEFINER and therefore runs as
-- the owner regardless of who called it. Nothing needs to reach the counters
-- directly, and anything that did could burn or forge a number.
-- ═══════════════════════════════════════════════════════════════════════════

grant select, insert, update, delete on public.organisations   to service_role;
grant select, insert, update, delete on public.profiles        to service_role;
grant select, insert, update, delete on public.audit_events    to service_role;
grant select, insert, update, delete on public.parties         to service_role;
grant select, insert, update, delete on public.document_series to service_role;
grant select, insert, update, delete on public.activity_types  to service_role;
grant select, insert, update, delete on public.activity_fields to service_role;
grant select, insert, update, delete on public.activities      to service_role;
grant select, insert, update, delete on public.documents       to service_role;
grant select, insert, update, delete on public.document_lines  to service_role;
grant select, insert, update, delete on public.document_taxes  to service_role;
grant select, insert, update, delete on public.payments        to service_role;
grant select, insert, update, delete on public.allocations     to service_role;

-- Views are readable but never written.
grant select on public.document_balances   to service_role;
grant select on public.party_outstanding   to service_role;
grant select on public.credit_balances     to service_role;
grant select on public.payment_balances    to service_role;
grant select on public.party_ready_to_bill to service_role;
grant select on public.activity_margin     to service_role;

-- Not granted, on purpose:
--   public.document_sequences — see the header.

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- revoke all on all tables in schema public from service_role;
