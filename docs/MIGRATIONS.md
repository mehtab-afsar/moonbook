# Database migrations — a map, not a folder

`supabase/migrations/` has to stay flat — the Supabase CLI only scans files
directly in that directory; anything nested in a subfolder is silently
skipped by `db reset`, `migration up` and `db push` alike (confirmed
directly: a probe file placed in a subfolder was never applied). So instead
of subfolders, this file is the map: which migrations belong to which part
of the system, in the order they were written.

**Deployment status matters here.** Migrations `20260916000001` through
`20260922000003` are already applied to the linked production project — they
are permanent, and must never be rewritten, renamed or squashed. Everything
from `20260923000001` onward has not shipped anywhere yet (check with
`supabase migration list --linked` — the `remote` column is blank for all of
them), which is what makes them safe to keep tidy as the schema evolves.

## Shared core (every vertical sits on this)

The tenant/tax/billing engine every business starts on, and that `shared`,
`logistics` and `plastics` orgs all still share for tenancy, parties and
tax — see "Cross-cutting" below for exactly which tables that is.

| Migration | What it adds |
|---|---|
| `20260916000001_extensions_and_helpers.sql` | Postgres extensions, `set_updated_at()` |
| `20260916000002_tenancy.sql` | `organisations`, `profiles`, `audit_events`, RLS helpers |
| `20260916000003_parties.sql` | `parties` |
| `20260916000004_numbering.sql` | Gapless document numbering, `create_organisation()` |
| `20260916000005_activities.sql` | `activities`, `activity_types`, `activity_fields` |
| `20260916000006_documents.sql` | `documents`, `document_lines`, `document_taxes` |
| `20260916000007_payments.sql` | `payments`, `allocations` |
| `20260916000008_views.sql` | `document_balances`, `payment_balances`, margin views |
| `20260916000009_ledger_rpcs.sql` | `record_activity`, `issue_document`, `record_payment`, `allocate` |
| `20260916000010_activity_validation.sql` | Field-shape validation for configurable activity types |
| `20260916000011_service_role_grants.sql` | Baseline service-role access |
| `20260916000012_industry_templates.sql` | `industry_templates`, `apply_industry_template()` |
| `20260916000013_document_printable_details.sql` | Frozen per-line detail on the issued snapshot |
| `20260916000014_debit_note_numbering.sql` | Debit notes join the numbering scheme |
| `20260916000015_update_activity.sql` | Correcting an unbilled activity |
| `20260916000016_credit_notes.sql` | Credit notes, cancellation |
| `20260916000017_owner_only_money.sql` | Owner-only gate on money-moving RPCs |
| `20260916000018_date_fields_must_be_dates.sql` | Field-type guard fix |
| `20260916000019_money_field_type.sql` | The `money` field type |
| `20260916000020_four_industries.sql` | Freight/scrap/hospitality/wholesale templates |
| `20260916000021_line_order.sql` | Explicit line ordering on documents |
| `20260921000001_allocate_direction_guard.sql` | `allocate()` refuses to cross receivable/payable |
| `20260921000002_freight_vendor_charge.sql` | Freight's payable activity type |
| `20260922000001_scrap_no_job_margin.sql` | Scrap's activity types stop claiming a per-job margin |
| `20260922000002_expenses.sql` | `expenses` — overhead, not tied to a job. Shared across every vertical, forked or not. |
| `20260922000003_activity_attachments.sql` | Proof-of-delivery file on an activity, `activity-attachments` bucket |

## Logistics vertical (its own tables, its own RPCs)

| Migration | What it adds |
|---|---|
| `20260923000001_logistics_vertical_schema.sql` | `logistics_activities/documents/payments/allocations` + RPCs |
| `20260923000002_logistics_vertical_migrate_freight_orgs.sql` | Moves existing freight orgs onto the fork |
| `20260927000001_logistics_service_vendor_ref.sql` | `assigned_vendor_id` column (internal-only note) |
| `20260928000001_logistics_activity_attachments.sql` | Proof-of-delivery RPC, reusing the shared bucket |
| `20260930000001_logistics_distance_km.sql` | `distance_km`; also where `record_logistics_activity` picks up `assigned_vendor_id` — see the file's own header for why it's not split across two migrations |

## Plastics vertical (same shape as logistics, independently)

| Migration | What it adds |
|---|---|
| `20260924000001_plastics_vertical_schema.sql` | `plastics_activities/documents/payments/allocations` + RPCs; also carries `assigned_vendor_id` (folded in directly, added for parity with logistics — see the column's own comment) |
| `20260924000002_plastics_vertical_migrate_scrap_orgs.sql` | Moves existing scrap orgs onto the fork |
| `20261001000002_plastics_activity_attachments.sql` | Proof-of-purchase RPC, mirrors `20260928000001` |

**Not ported to plastics, on purpose:** `distance_km`. It's a freight concept
(how far a trip travelled) with no equivalent in buying/selling scrap by
weight — porting it anyway would just be a column nothing ever fills in.

## Cross-cutting (touch the shared tables, so every vertical gets them at once)

These don't fork — `organisations` and `parties` are the tenancy tables all
three verticals still share, so a migration here reaches shared, logistics
*and* plastics orgs in one place, with nothing vertical-specific to repeat.

| Migration | What it adds |
|---|---|
| `20260925000001_activate_vertical.sql` | `activate_vertical()` — auto-forks a new signup onto logistics/plastics |
| `20260926000001_party_payout_details.sql` | Bank/UPI fields on `parties`, for paying a vendor |
| `20260929000001_allocate_lock_source_row.sql` | Real concurrency fix: locks the payment/note row too, not just the target document, in `allocate()`/`allocate_logistics()`/`allocate_plastics()` |
| `20260929000002_party_kind_and_dedup.sql` | `parties.kind` (client/vendor tab placement), duplicate-name handling |
| `20260930000002_org_logo.sql` | Org logo for the PDF letterhead, `org-logos` bucket |
| `20261001000001_org_invites.sql` | Team invites — `org_invites`, `accept_org_invite()`, `cancel_org_invite()` |

## Adding a new migration

- Touching only shared tables (`organisations`, `parties`, `profiles`,
  `expenses`)? One migration, no vertical suffix needed — it reaches every
  vertical automatically.
- Touching one vertical's own tables? Name it so the vertical is obvious in
  the filename (already the convention: `logistics_...`, `plastics_...`),
  and add a row to that vertical's table above.
- Redefining a function that hasn't shipped to remote yet (check
  `supabase migration list --linked` first)? Edit its most recent
  unshipped definition in place rather than adding a new migration that
  immediately replaces it — see `20260930000001_logistics_distance_km.sql`'s
  own header for the reasoning and the exact `drop function` gotcha this
  avoids.
