-- ═══════════════════════════════════════════════════════════════════════════
-- 29 · Fork a brand-new organisation onto a vertical ledger at signup time
--
-- The 27/28 migrations moved *existing* freight/scrap orgs onto their own
-- ledgers. Nothing, until now, did the equivalent for an org created fresh —
-- apply_industry_template() only ever touched the shared activity_types
-- tables, so a brand-new signup picking "Freight & logistics" or "Scrap &
-- recycling" stayed on vertical = 'shared' and never saw its dedicated app.
--
-- activate_vertical() is that missing step for the signup path: owner-only,
-- flips organisations.vertical, and seeds that vertical's invoice/bill
-- document series the same way create_organisation seeds the shared one.
-- No data migration is needed here — a fresh org has nothing to move.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.activate_vertical(p_vertical text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select public.current_org_id());
begin
  if v_org is null then
    raise exception 'activate_vertical: no organisation for this account' using errcode = '28000';
  end if;
  if not (select public.has_role('owner')) then
    raise exception 'activate_vertical: requires the owner role' using errcode = '42501';
  end if;
  if p_vertical not in ('logistics', 'plastics') then
    raise exception 'activate_vertical: unknown vertical %', p_vertical using errcode = '22023';
  end if;

  -- Idempotent: an org already on this vertical (or a re-submitted request)
  -- just no-ops rather than erroring.
  if exists (select 1 from public.organisations where id = v_org and vertical = p_vertical) then
    return;
  end if;
  if not exists (select 1 from public.organisations where id = v_org and vertical = 'shared') then
    raise exception 'activate_vertical: organisation is already on a different vertical' using errcode = '55000';
  end if;

  if p_vertical = 'logistics' then
    insert into public.logistics_document_series (org_id, doc_kind, prefix, is_self_numbered)
    values (v_org, 'invoice', 'INV', true), (v_org, 'bill', 'BILL', false)
    on conflict (org_id, doc_kind) do nothing;
  else
    insert into public.plastics_document_series (org_id, doc_kind, prefix, is_self_numbered)
    values (v_org, 'invoice', 'INV', true), (v_org, 'bill', 'BILL', false)
    on conflict (org_id, doc_kind) do nothing;
  end if;

  update public.organisations set vertical = p_vertical where id = v_org;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, after)
  values (v_org, auth.uid(), 'organisation.vertical_activated', 'organisation', v_org,
          jsonb_build_object('vertical', p_vertical));
end;
$$;

comment on function public.activate_vertical(text) is
  'Owner-only. Forks a brand-new organisation still on vertical = ''shared'' onto its dedicated logistics or plastics ledger, seeding that vertical''s invoice/bill document series. Called once, right after create_organisation, for signups whose chosen template forks off the shared engine.';

revoke execute on function public.activate_vertical(text) from public;
grant  execute on function public.activate_vertical(text) to authenticated;

-- ─── Rollback ──────────────────────────────────────────────────────────────
-- drop function if exists public.activate_vertical(text);
