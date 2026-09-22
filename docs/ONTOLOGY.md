# The ontology, its fork precedent, and when to use which

Written for whoever next decides "does this vertical need its own tables."
That decision has been made twice already (freight, scrap) without a written
rule to check it against — this document is that rule, plus the two decisions
it should have been checked against, written down after the fact.

---

## What the ontology actually is

`activity_types` + `activity_fields` is a real, working ontology in the
Foundry sense: object types and their properties are **rows**, not code.

```sql
insert into public.industry_templates ...;   -- what the signup picker offers
insert into public.activity_types ...;       -- what this trade records
insert into public.activity_fields ...;      -- the fields on that record
```

Adding an industry to the shared engine is an INSERT, not a migration — see
`docs/INDUSTRY-FIT.md` for the full mechanism and the test that enforces it.

Two things make this more than a JSONB bag with extra steps:

- **The typed spine never reads `details`.** Every balance, ageing report and
  tax computation reads only real, indexed columns (party, date, amount,
  currency, direction, status). The free-shaped part is descriptive only —
  origin/destination, material grade, SKU — printed and searched, never
  computed on. `__tests__/spine-purity.test.ts` asserts this mechanically.
- **A template is copied, not referenced.** `apply_industry_template()` deep-
  copies system rows into the org's own `activity_types`/`activity_fields` at
  signup. The org owns an editable copy; a later change to the system
  template can never silently rewrite what a customer already configured.

## What it is not (yet)

No relationship/link-type concept exists between object types — an activity
references exactly two fixed things, `party_id` and `bill_to_party_id`, both
hardcoded foreign keys. No computed/derived-property concept exists either —
`uses_job_margin` is a hardcoded boolean gate on one hardcoded formula
(revenue − direct cost), not a general "define a derived field." And no
self-serve editing exists: an org owner can see their own copied
`activity_types`/`activity_fields` in Settings, but cannot add a field to
their own copy — only a migration (system-wide) or a manual database write
(one org) can, today.

None of these are bugs. They are unbuilt, on purpose, because nothing has yet
needed them badly enough to justify a formula-language-shaped risk in a
financial core that otherwise deliberately has none (see CONVENTIONS.md §10's
"closed set of pricing strategies, no formula language" stance). Build them
when a vertical actually hits the wall, not before — the same reasoning as
the fork threshold below.

## The fork precedent — what actually happened, and why

Freight and scrap are no longer served by the shared ontology for their
money-moving data. `activate_vertical()` runs right after
`apply_industry_template()` at signup and migrates the org onto its own
tables: `logistics_activities`/`logistics_documents`/`logistics_payments` for
freight, the `plastics_*` equivalents for scrap. Each fork's own migration
gives the same reasoning, in its own words:

> A forked vertical does not need `activity_types`/`activity_fields`: it
> serves one trade, so its own fields can be real, typed columns instead of a
> free-shaped configuration blob validated against configurable rows.

That is a legitimate trade-off — typed columns are faster to query, easier
to index, and safer to reason about than a JSONB bag — but it is the opposite
of "highly configurable across industries." Every vertical forked this way is
one more bespoke schema, one more set of RLS policies, one more route tree to
maintain, and the "adding an industry is an INSERT" promise stops being true
for that vertical's financial data the moment it forks.

**One nuance worth being precise about:** the ontology isn't bypassed for
freight/scrap, it's the onboarding layer for them too. `apply_industry_template()`
still runs first, copying their `activity_types`/`activity_fields` in exactly
like hospitality or wholesale — `activate_vertical()` is a *second*, separate
step that then migrates the org's activities/documents/payments off those
shared tables onto the vertical's own. The ontology decides what a trip or a
purchase *looks like* at signup; the fork decides which tables actually store
one, afterward.

## The fork threshold

A vertical forks out of the shared ontology only when **both** are true:

1. **It has real paying orgs on it** — not a guess at future demand. Freight
   and scrap forked with actual freight-template and scrap-template orgs
   already live on the shared engine, not speculatively ahead of any.
2. **It has hit a relational or query need the generic engine cannot
   express.** Freight's own reason was trip-level reporting (route ageing,
   vehicle utilisation) that a `details` JSONB blob can't index or join
   efficiently. "It would be nice to have typed columns" is not this bar by
   itself — plenty of `activity_fields` rows are typed (`number`, `money`,
   `date`) without needing a fork; the bar is a need the *typed spine* can't
   express, not a preference for less JSONB.

If only (1) is true, the answer is: it stays on the shared engine, and if
that's wrong later, it's an `activate_vertical()` migration away — reversible,
same as it was for freight and scrap. If only (2) is true without real orgs
yet, the answer is: also no — build the relational capability *into the
ontology* first (a link-type concept, if it comes to that) rather than fork a
vertical that doesn't exist yet against a need nobody has confirmed. The cost
of forking too early is a maintenance burden with no vertical stable enough
yet to justify it; the cost of forking too late is some awkward JSONB
querying until the fork happens — the second is cheaper to be wrong about.

## Hospitality and wholesale, decided

Both are still on the shared engine. That is the decision, not a placeholder
for one: **neither has a paying-org base and a confirmed relational need that
clears the threshold above.** Wholesale's actual, documented blocker
(`docs/INDUSTRY-FIT.md`) is per-line tax rates, which shipped in the shared
engine itself (`activities.tax_rate_pct`, `document_lines.tax_rate_pct`,
`lib/tax/computeTaxGrouped`) rather than by forking — because it was a typed-
spine gap, not a relational one, and the fix made every shared-engine
vertical's invoices correct, not just wholesale's. Neither hospitality nor
wholesale has surfaced a need the ontology genuinely cannot express. Revisit
this call only when one does — a specific relational need with real orgs
behind it — not on a schedule.

## For the next vertical decision

1. Check the threshold above against real evidence, not a hunch.
2. If it forks, follow freight/plastics as the literal template: activation
   step immediately after template application, own `*_activities`/
   `*_documents`/`*_payments`/`*_allocations` tables, own RPCs mirroring the
   shared engine's validation and locking rules (not shared code — see
   `docs/MIGRATIONS.md`'s "Logistics vertical" section for the exact
   migration sequence that did this), own route tree, own data migration for
   existing orgs on that template.
3. Write the decision down here, in this file, the way this one is — the
   next person deciding should be reading a precedent, not starting from
   vibes the way freight and scrap's fork calls did.
