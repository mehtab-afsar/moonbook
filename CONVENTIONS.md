# Moonbook conventions

Distilled from 13 LedgerFlow migrations with its drifts removed. These are enforced by
the guard tests in `__tests__/` wherever a machine can check them — the rest is on us.

---

## 0. The load-bearing invariant

**The typed spine never touches the descriptive body.**

Every billable event reduces to: *someone (party) · did something on a date · worth an
amount · in a currency · flowing one way · in some state*. Those are real, typed, indexed
columns, and **every balance, dashboard, ageing report and ledger view reads only these.**

Everything industry-specific lives in `activities.details jsonb`. It prints on documents
and is searchable. **No financial computation ever reads it.**

Enforced by `__tests__/spine-purity.test.ts`: `details` may not appear in any migration
except the activities table, its validation trigger, and the document-rendering RPC.

Two supporting rules:
- **Closed sets, never languages.** Field types, pricing strategies, tax regimes and
  document states are each a small, fixed, tested list. A formula parser is an unbounded
  bug surface and an injection hole.
- **Templates are data, not code.** An industry template is rows copied into a new org.
  Adding one is an INSERT, never a deploy.

---

## 1. RLS helper functions

```sql
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from public.profiles where id = (select auth.uid())
$$;
```

`security definer` is **not optional** — it is what breaks RLS recursion on `profiles`.
A `security invoker` version would re-trigger `profiles_select`, which calls the helper,
which reads `profiles`… and Postgres raises *infinite recursion detected in policy*.

`stable` (not `volatile`) lets the planner cache within a statement. `set search_path = ''`
is mandatory on every definer function and forces fully-qualified names.

Always `revoke execute … from public` then `grant execute … to authenticated`, and always
a `comment on function`.

## 2. RLS policies

- Named `"<table>_<action>"`, always preceded by `drop policy if exists` (Postgres has no
  `CREATE POLICY IF NOT EXISTS`).
- **Always `to authenticated`.** A policy without it applies to `PUBLIC`, i.e. also
  `anon`.
- **Always `(select public.current_org_id())`**, never the bare call. The parenthesised
  subselect is hoisted to an InitPlan evaluated once per query; the bare call is
  re-evaluated once per row.
- **Every `for update` and `for all` carries both `using` and `with check`.** A missing
  `with check` lets a row be updated *out of* its tenant.
- No `DELETE` policy by default: rows are deactivated, never deleted, so issued documents
  keep their references.

LedgerFlow's `expenses` table breaks the first three of these simultaneously. Don't copy
that one.

## 3. SECURITY DEFINER RPCs

```sql
create or replace function public.verb_noun(
  p_required uuid,
  -- Trailing and defaulted so PostgREST can omit them. Postgres requires every
  -- parameter after the first defaulted one to also have a default.
  p_optional text default null
)
returns table (id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select public.current_org_id());
  v_uid uuid := auth.uid();
begin
  if v_org is null then
    raise exception 'verb_noun: no organisation for this account' using errcode = '28000';
  end if;
  ...
end;
$$;
```

- Modifier order always `language plpgsql` → `volatile` → `security definer` → `set search_path = ''`.
- `p_` for parameters, `v_` for locals, locals initialised in `declare`.
- **Unconditional `v_org is null` guard first**, role guard second, argument validity
  third, existence/state fourth, locking + duplicate checks last.
- `returns table (...)` + `return query` even for a single scalar, so `.single()` works
  uniformly through PostgREST.
- Error messages are `'<function_name>: <lowercase human sentence>'` with an explicit
  `using errcode`.
- `comment on function` is mandatory; `revoke`/`grant` repeat the full signature.

## 4. RPCs never take an org id

Derive the org from `current_org_id()`. Never accept it as a parameter.

LedgerFlow's `next_doc_number(p_org_id, …)` takes one, never validates it, and is granted
to `authenticated` — so any signed-in user can advance a **stranger's** invoice counter
and punch a permanent gap in their book. If an internal helper genuinely must take an
org id, `revoke execute from authenticated` entirely and let only definer callers reach it.

## 5. SQLSTATE → HTTP

One shared map in the API layer, never per-route `if (error.code === …)`.

| code | meaning | HTTP |
|---|---|---|
| `28000` | no authenticated user / no org | 401 |
| `42501` | role gate failed | 403 |
| `P0002` | not found, wrong org, or wrong state | 404 |
| `23505` | already exists / already done | 409 |
| `23514` | business rule violated | 409 |
| `22003` | amount out of range, allocation exceeds | 422 |
| `22023` | unknown enum-ish argument | 422 |
| `22004` | required argument null/blank | 422 |

LedgerFlow maps only four of these, inline per route; the other four surface as opaque
500s.

## 6. Views

```sql
create or replace view public.some_view
with (security_invoker = true) as
select ...;
```

**`security_invoker = true` is not optional.** A view created by the migration role
(which has BYPASSRLS) otherwise runs with the *view owner's* privileges and silently
leaks every tenant's data to every signed-in user.

- Always carry `org_id` through the output so views can layer on views.
- **Derived, never cached.** Balances are recomputed on every read. There is no stored
  counter anywhere in this schema, ever.
- Aggregate with `count(*) filter (where …)` and `coalesce(sum(…) filter (where …), 0)`.

## 7. Migrations

- Filename `YYYYMMDDNNNNNN_snake_case_topic.sql`.
- Banner header stating **why**, not what.
- Fully idempotent: `create table if not exists`, `create or replace function|view`,
  `drop policy|trigger if exists` before create. Postgres has no `IF NOT EXISTS` for
  policies, triggers, or `ADD CONSTRAINT` — wrap the last in a `do $$ … pg_constraint $$`
  block.
- Every constraint explicitly named inline: `constraint <table>_<subject>_chk check (…)`.
- Enums are `text` + `check (col in (…))`, never Postgres `enum` types, so adding a value
  is a constraint swap rather than a type alter.
- Trailing commented `-- ─── Rollback ───` block in reverse dependency order.

**Superseding a function**: identical signature, full body copied forward **with its
inline comments intact**, header naming the exact base version, `comment on function`
rewritten as the cumulative changelog, `revoke`/`grant` repeated. LedgerFlow lost its
best `create_invoice` comments this way — the best-documented copy is now the oldest,
dead one.

## 8. The two rules LedgerFlow never wrote down

It drifted on both. Moonbook picks one of each and holds to it.

**Child-table scoping: denormalise `org_id`.** Every table carries its own `org_id` and
uses the plain `org_id = (select public.current_org_id())` policy — including children
like `document_lines` and `allocations`. LedgerFlow has two strategies coexisting
(`invoice_lines` scopes via `exists (… parent …)` with no `org_id`; `credit_notes`
denormalises) with no stated rule. Denormalised wins here: cheaper to filter, cheaper to
index, and one policy shape to audit.

**`updated_at`: mutable tables only.** A table gets `updated_at` **and** the
`set_updated_at()` trigger if and only if its rows are ever updated in place. Append-only
and immutable tables (`audit_events`, `allocations`, `payments`, `document_taxes`) get
`created_at` only, and their immutability is enforced by the absence of an UPDATE policy
and grant. LedgerFlow's migration 01 claims the trigger is on "every table below"; it is
on 5 of 16.

## 9. PostgREST embeds fail loudly — check `error`

Two traps, both of which return an **empty result that looks like "no rows"**
while actually being a failed query:

1. **A view cannot be embedded.** PostgREST only embeds across a real foreign
   key, so `.select("...some_view(...)")` fails with `PGRST200`. Fetch the view
   separately and merge in JS.
2. **An ambiguous embed is an error.** `activity_fields` reaches
   `activity_types` by two foreign keys — the plain `activity_type_id` one and
   the composite `(activity_type_id, org_id)` that pins a field to its own
   organisation. Both are deliberate, so the ambiguity is permanent: always
   name the key — `activity_fields!activity_fields_activity_type_id_fkey(...)`.

Neither degrades. Both produce `data: null` alongside an `error`, so:

```ts
const { data, error } = await supabase.from(...).select(...);
if (error) throw new Error(`...: ${error.message}`);
```

**Never destructure `{ data }` alone from a Supabase call.** An empty list and
a broken query render identically, and the broken one is the one worth knowing
about. This has now caused the same silent bug twice across two codebases.

## 10. Money

- Integer minor units in `bigint`, always named `*_minor`, always paired with a
  `currency char(3)` column.
- **No arithmetic on money outside `lib/money.ts`.** PostgREST serialises Postgres
  `numeric` to a JS float; `0.1 + 0.2 !== 0.3`, and an invoice total drifts by a unit
  that an accountant eventually finds.
- Minor-unit exponents come from the ISO-4217 currency registry (INR/USD/GBP = 2,
  JPY = 0, KWD/BHD = 3). There is no bare `toPaise`.
- **No FX.** One currency per document; outstanding totals are reported per currency,
  never blended. A blended total needs a rate, a rate date, and a revaluation policy.

## 11. Tax

All tax computation lives in `lib/tax/`, dispatched on `organisations.tax_regime`, and
is **never duplicated in SQL**. RPCs accept a pre-computed breakdown as a parameter.

Tax lands in the `document_taxes` child table — one row per component — never as fixed
`cgst`/`sgst`/`igst` columns. India produces two rows or one; the UK produces one; a
tax-free org produces none. The PDF renders whatever rows exist.

## 12. Issued documents render from their snapshot, and only from it

`issue_document()` freezes an `issued_snapshot` holding the document, its lines, its tax
components, both parties, the organisation, and each line's **printable details** —
the activity's `details` values resolved against the field definitions marked
`show_on_document`, with the label frozen alongside the value.

**Nothing that renders an issued document may join a live table.** Not the organisation,
not the party, not the field definitions. An invoice is a statement of fact made on a
date; if the PDF rebuilt itself from live rows, renaming a field or archiving it would
silently reword documents already sent to a customer and filed with a tax authority.

Two consequences worth stating:

- A draft has no snapshot and therefore no PDF. That is the correct answer, not a gap.
- The snapshot is the one piece of data that outlives every schema it came from, so it
  is **parsed** (`lib/pdf/snapshot.ts`), never trusted. Anything added after the first
  release is `.optional()` with a default, because old snapshots are immutable and will
  never gain the new keys. A snapshot that no longer fits fails loudly with the field
  named — a silently-missing key renders a blank total, which looks like a document
  rather than like an error.

This is also the only place the descriptive body crosses into the document layer, and it
crosses as **rendered text**: read once at issue, never computed on. The spine-purity
guard allows `details` in that one migration for exactly this reason.

## 13. PDFs are typeset in the base fonts, so they name currencies by code

`@react-pdf/renderer` ships the PDF base fonts, whose standard encoding has no `₹`. An
Indian invoice formatted with `display: "symbol"` renders a broken glyph in place of the
single most important number on the page — and it does so silently, since there is no
error, only a wrong-looking box.

So PDFs format with `formatMoney(..., { display: "code" })` — `INR 1,00,000.00` — while
the web app uses the symbol, because the browser has the glyph. Embedding a font that
covers the symbol is the eventual fix; naming the currency is the correct one meanwhile,
and on a cross-border document it is arguably better anyway.

The same limitation applies to scripts: PDFs are **English only**. `@react-pdf` has no
HarfBuzz, so Devanagari and Arabic render as broken glyphs. Localisation lives in the
web UI.

## 14. End-to-end tests

`e2e/` runs in Playwright against a real browser, the real dev server and the real
local database. `__tests__/` stays what it is — static guards over the migration files,
no database, fast enough for every commit. Neither replaces the other.

**One tenant per test.** `e2e/fixtures.ts` creates a fresh organisation for each test and
signs the browser in as its owner. This is not tidiness; it is what makes the tenancy
boundary exercised on *every* test rather than in one dedicated spec. If a policy leaked,
every count assertion in the suite would start failing at once.

**Nothing is torn down.** `documents.created_by` references the profile with no cascade,
so a user who has issued an invoice cannot be deleted — the database refusing to erase
who issued a document is correct for an audit trail, and a suite that fought it would be
arguing with the product. `npm run db:reset` is the cleanup.

**Preconditions go through the product, never the service role.** `e2e/helpers/seed.ts`
uses the tenant's own RLS-scoped client and the tenant's own signed-in request context.
Seeding with the service role would let a spec assert on rows the product itself could
not have created, which is how a broken policy hides inside its own setup.

**The two deliberate exceptions**, both via `e2e/helpers/psql.ts`:
- `industry_templates` has no write grant for *any* client role, service role included,
  because it is shared between every business. Adding an industry is an operator action,
  and the test runs it as one rather than weakening the grant.
- `documents` is select-only to clients — all writes go through RPCs — so a state the
  product cannot reach (a draft with no snapshot) has to be built by hand to test that
  the PDF route refuses it.

**On parallelism.** The build plan called for `workers: 1` because "gapless numbering is
global state". That is not true of the schema that was written: `document_sequences` is
keyed `(org_id, doc_kind, period_key)`, so two tenants cannot contend for a number, and
Mailpit is searched by recipient, which is unique per test. The real constraint is
`next dev` compiling routes lazily, which costs latency and not correctness — hence a
small worker count and generous timeouts. Measured: 41 tests in ~30s, three consecutive
runs with no reset between them and no flakes.

**Only one spec waits on email.** `onboarding.spec.ts` walks the real magic link out of
Mailpit, because the link being sent and being redeemable is itself a thing that breaks.
Everywhere else a session is minted directly and written as the cookie `@supabase/ssr`
expects — forty specs depending on SMTP buys no coverage and loses reliability.

**A local clock artefact worth knowing about.** GoTrue stamps a JWT's `iat` as a whole
second while PostgREST checks it against a sub-second clock, so a token issued at x.9s
can briefly look like it was issued in the future and PostgREST answers *JWT issued at
future*. No real browser is fast enough to hit this. `waitUntilTokenAccepted` polls until
the token is usable rather than sleeping and hoping.
