# Which industries Moonbook actually serves

Written for whoever is deciding what to sell, and to whom.

Every claim below is backed by a test in `e2e/industry-fit.spec.ts`. Where
something does not fit, the test asserts the limit rather than avoiding it, so
the day it is fixed the test fails and has to be rewritten on purpose.

---

## What Moonbook is

One codebase that bills for businesses that record different things.

The whole design rests on a split. A **typed spine** — party, date, amount,
currency, direction, status — is real, indexed columns, and every balance,
ageing report and ledger view reads only these. A **descriptive body**,
`activities.details`, holds whatever makes an industry itself: origin and
destination, material grade, weighbridge slip, SKU. It prints on documents and
is searchable, and **no financial computation ever touches it.**

So the financial core never learns what trade it is serving, and an industry is
rows rather than a release. Adding one is:

```sql
insert into public.industry_templates ...;   -- what the signup picker offers
insert into public.activity_types ...;       -- what this trade records
insert into public.activity_fields ...;      -- the fields on that record
```

No migration adds a column for an industry. No branch in `lib/tax`, in
`issue_document` or in the renderer mentions one. That is asserted mechanically:
the test strips comments and greps the source for industry names.

## How a business actually uses it

1. **Set up** — country, currency, tax regime and financial year follow from
   one question. Pick the trade; its activity types are copied in as your own.
2. **Record what you did** — the form has no fields of its own. It renders
   whatever your activity types say, and prices the row by the strategy they
   carry: typed, fixed, or quantity × rate.
3. **Bill it** — choose who pays and which work. Tax is computed from your
   regime and the customer's region; the document is numbered gaplessly from
   the right financial year and **frozen**. Later configuration changes cannot
   reword an invoice already sent.
4. **Take the money** — allocate across invoices, leave the remainder as
   credit, apply it later.
5. **Put it right** — correct unbilled work, cancel a document nothing has been
   applied to, credit one that has taken money.

---

## The five templates that ship

| Template | Records | Prices by | Direction |
|---|---|---|---|
| `freight` | Trips: origin, destination, vehicle, load type | typed | receivable |
| `scrap` | Purchases **and** sales: material, grade, weight, rate | weight × rate | **both** |
| `hospitality` | Orders: type, covers, served-on, reference | typed | receivable |
| `wholesale` | Goods: product, SKU, units, unit price | units × price | receivable |
| `generic` | One open description | typed | receivable |

---

## Does it fit?

### Logistics — yes

The trade it was designed against. Trips carry their own fields onto the
invoice, and a load delivered to a consignee can be billed to the broker who
booked it, with tax following the **payer's** region rather than the lorry's
destination.

### Scrap and recycling — yes, and it stretches the model usefully

The only template that bills in both directions: material bought from a
collector is a payable, material sold on is a receivable, and the two ledgers
are kept separately and never netted. Pricing is weight × rate, with the rate
recorded per load because it moves weekly.

**One caveat.** Margin is meaningful per *period*, not per *job*: 500 kg of PET
bought on Monday does not map to 2 t of flake sold on Friday. `uses_job_margin`
carries that distinction so a report can tell the difference rather than
printing fiction.

### Hospitality — partly, and the part it misses is most of the volume

Account customers work completely: catering, functions and monthly tabs bill,
settle and age like anything else.

**Counter sales do not, and should not.** `activities.party_id` is NOT NULL,
because the ledger is built around who owes what, and a flat white paid for in
cash creates no debt. Inventing a "Walk-in" party would file every cash sale in
the year against one customer's outstanding balance.

> A café needs a till for the counter and Moonbook for the accounts. Selling it
> as a café system would be selling the wrong product.

### Wholesale — **blocked on one thing**

Multi-line invoices work well. Three products on one delivery become three
lines, each carrying its own product, SKU, units and unit price, in the order
they were chosen.

**Mixed tax rates on one invoice do not work, and Indian wholesale needs them.**
Edible oil is 5%, most groceries 18%, and a single delivery routinely mixes
them. Moonbook has **one `tax_treatment` and one `taxable_value_minor` per
document**, and `document_lines` carries no rate of its own, so every line is
taxed at the organisation's single rate.

This is the plan's own open item #2 — "per-line tax rates… changes
`document_taxes` from per-document to per-line" — and wholesale is the customer
that forces it. It is a schema change, and it gets more expensive with every
invoice already issued.

---

## The four things to decide

1. **Per-line tax rates.** Wholesale is not sellable without them. Cheap now,
   expensive later.
2. **Rounding policy per regime.** `round_off_minor` exists and nothing
   populates it. GST rounds each half independently to match Tally.
3. **Payables screens.** The schema and RPCs handle both directions and scrap
   uses both — but there is no supplier-bill UI, so a scrap yard records
   purchases and cannot see a payables list.
4. **Counter sales.** Only if hospitality is a market worth entering, and the
   answer is probably a different product.

## What is deliberately absent

No formula language — pricing is a closed set of three. No inventory or stock.
No FX; one currency per document and totals reported per currency, never
blended. No self-serve configuration UI yet: applying a template on a
customer's behalf takes minutes, which serves the first ten to twenty
customers.
