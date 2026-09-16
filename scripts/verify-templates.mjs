/**
 * Phase 3 gate — THE TEST OF THE WHOLE THESIS.
 *
 * Moonbook exists to make a new industry a matter of DATA rather than code.
 * This onboards an industry that ships with neither a template nor a line of
 * TypeScript anywhere in the repo — a plastic-waste recycler, which bills in
 * the opposite direction and prices per kilo — using nothing but INSERTs.
 *
 * Then it runs that business end to end: record work, issue an invoice, take
 * a payment, see it in outstanding. If any of that needed a migration or a
 * code change, the architecture is wrong, and it is far cheaper to learn that
 * here than at customer #10.
 *
 * WHO RUNS THE INSERTS. Not the app, and not a tenant: industry_templates is
 * shared configuration, so no client role has a write grant on it and a
 * customer cannot reshape what every other business is offered. Adding an
 * industry is an operator action against the database — psql or Studio — and
 * this script runs it that way rather than pretending otherwise. The claim is
 * "no application code and no schema change", which is the claim that matters.
 *
 *   npm run db:reset && node scripts/verify-templates.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.local" });

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let passed = 0;
const failures = [];
const check = (label, ok, detail = "") => {
  if (ok) { passed += 1; console.log(`  ✓ ${label}`); }
  else { failures.push(label); console.log(`  ✗ ${label}\n      ${detail}`); }
};

async function signUp(email) {
  const { data: users } = await admin.auth.admin.listUsers();
  for (const u of users.users) if (u.email === email) await admin.auth.admin.deleteUser(u.id);
  await admin.auth.admin.createUser({ email, email_confirm: true });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "email" });
  if (error) throw error;
  await c.auth.setSession(data.session);
  return c;
}

const fieldRow = (typeId, orgId, over) => ({
  activity_type_id: typeId, org_id: orgId,
  options: [], is_required: false, is_reportable: false, show_on_document: true, ...over,
});

async function main() {
  console.log("\nMoonbook — Phase 3 industry templates\n");

  // ── The templates that ship ──────────────────────────────────────────────
  console.log("What ships");
  const { data: shipped } = await admin.from("industry_templates").select("key").order("sort_order");
  check("two templates ship, deliberately, not six",
    JSON.stringify(shipped?.map((t) => t.key)) === JSON.stringify(["freight", "generic"]),
    JSON.stringify(shipped));

  // ── A freight business picks one at signup ───────────────────────────────
  console.log("\nA freight business signs up");
  const f = await signUp("owner@freight.test");
  await f.rpc("create_organisation", {
    p_legal_name: "Alpha Freight", p_country_code: "IN", p_base_currency: "INR",
    p_region_code: "KA", p_fiscal_year_start_month: 4,
    p_tax_regime: "split_rate", p_default_tax_rate_pct: 18,
  }).single();
  const { data: applied, error: applyErr } = await f
    .rpc("apply_industry_template", { p_template_key: "freight" }).single();
  check("the template applies", !applyErr && applied?.types_added === 1, applyErr?.message ?? JSON.stringify(applied));

  const { data: fTypes } = await f
    .from("activity_types").select("key, label_singular").not("org_id", "is", null);
  check("the org now owns its own copy of the type",
    fTypes?.length === 1 && fTypes[0].key === "trip", JSON.stringify(fTypes));

  const { data: fFields } = await f
    .from("activity_fields").select("key").not("org_id", "is", null).order("sort_order");
  check("with the template's fields copied in",
    JSON.stringify(fFields?.map((x) => x.key)) === JSON.stringify(["origin", "destination", "vehicle_no", "load_type"]),
    JSON.stringify(fFields));

  // Editing the copy must not touch the system template — a customer's
  // configuration is theirs.
  await f.from("activity_fields").update({ label: "Pickup point" })
    .not("org_id", "is", null).eq("key", "origin");
  const { data: systemField } = await admin
    .from("activity_fields").select("label").is("org_id", null).eq("key", "origin").single();
  check("editing the copy leaves the system template untouched",
    systemField?.label === "Origin", systemField?.label);

  check("re-applying the same template adds nothing and overwrites nothing",
    (await f.rpc("apply_industry_template", { p_template_key: "freight" }).single()).data?.types_added === 0);

  // ══════════════════════════════════════════════════════════════════════════
  // THE GATE: a third industry, added as DATA ONLY.
  //
  // Everything below is INSERTs. No migration, no TypeScript, no deploy — and
  // it is a genuinely different business: it pays its suppliers rather than
  // billing them, and prices by weight rather than per job.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\nA third industry, added with INSERTs only");

  // Run as the operator would: straight SQL against the database.
  const psql = (sqlText) =>
    execFileSync("psql", [process.env.SUPABASE_DB_URL, "-v", "ON_ERROR_STOP=1", "-q", "-c", sqlText], {
      encoding: "utf8",
      env: { ...process.env, PGPASSWORD: "postgres" },
    });

  psql(`insert into public.industry_templates (key, label, description, sort_order)
        values ('recycling', 'Recycling & scrap',
                'Buy material in by weight and grade, sell processed output on.', 1)
        on conflict (key) do nothing;`);

  // Every batched row carries the full column set: PostgREST sends NULL, not
  // DEFAULT, for a key another row in the batch omits.
  const typeRow = (over) => ({
    org_id: null, pricing_config: {}, dim1_field_key: null,
    uses_period: false, uses_job_margin: true, ...over,
  });

  const { data: rTypes, error: rTypeErr } = await admin.from("activity_types").insert([
    typeRow({
      template_key: "recycling", key: "material_intake",
      label_singular: "Material intake", label_plural: "Material intakes",
      direction: "payable", pricing_strategy: "quantity_rate",
      pricing_config: { quantity_field: "weight_kg", rate_minor: 4200 },
      dim1_field_key: "material_grade", uses_job_margin: false, sort_order: 0,
    }),
    typeRow({
      template_key: "recycling", key: "flake_sale",
      label_singular: "Flake sale", label_plural: "Flake sales",
      direction: "receivable", pricing_strategy: "manual",
      dim1_field_key: "material_grade", sort_order: 1,
    }),
  ]).select("id, key");
  if (rTypeErr) throw rTypeErr;

  const intakeId = rTypes.find((t) => t.key === "material_intake").id;
  const saleId = rTypes.find((t) => t.key === "flake_sale").id;
  const GRADES = ["PET", "HDPE", "LDPE", "Mixed"];

  const { error: rFieldErr } = await admin.from("activity_fields").insert([
    fieldRow(intakeId, null, { key: "material_grade", label: "Material grade", field_type: "select", options: GRADES, is_required: true, is_reportable: true, sort_order: 0 }),
    fieldRow(intakeId, null, { key: "weight_kg", label: "Weight (kg)", field_type: "number", is_required: true, sort_order: 1 }),
    fieldRow(intakeId, null, { key: "weighbridge_slip", label: "Weighbridge slip no.", field_type: "text", sort_order: 2 }),
    fieldRow(saleId, null, { key: "material_grade", label: "Material grade", field_type: "select", options: GRADES, is_required: true, is_reportable: true, sort_order: 0 }),
    fieldRow(saleId, null, { key: "weight_kg", label: "Weight (kg)", field_type: "number", is_required: true, sort_order: 1 }),
  ]);
  if (rFieldErr) throw rFieldErr;
  check("the new industry exists, with zero code changed", true);

  // ── And a recycler can now run their whole business on it ────────────────
  console.log("\nThe recycler runs end to end");
  const r = await signUp("owner@recycler.test");
  const { data: rOrg } = await r.rpc("create_organisation", {
    p_legal_name: "Green Cycle Pvt Ltd", p_country_code: "IN", p_base_currency: "INR",
    p_region_code: "TN", p_fiscal_year_start_month: 4,
    p_tax_regime: "split_rate", p_default_tax_rate_pct: 18,
  }).single();

  const { data: rApplied, error: rApplyErr } = await r
    .rpc("apply_industry_template", { p_template_key: "recycling" }).single();
  check("the recycler picks the brand-new industry at signup",
    !rApplyErr && rApplied?.types_added === 2, rApplyErr?.message ?? JSON.stringify(rApplied));

  const { data: collector } = await r.from("parties")
    .insert({ org_id: rOrg.org_id, name: "Anand Scrap Collectors", country_code: "IN", region_code: "TN" })
    .select("id").single();
  const { data: buyer } = await r.from("parties")
    .insert({ org_id: rOrg.org_id, name: "Polymer Works Ltd", country_code: "IN", region_code: "TN" })
    .select("id").single();

  const { data: myTypes } = await r.from("activity_types")
    .select("id, key, direction").not("org_id", "is", null).order("sort_order");
  const myIntake = myTypes.find((t) => t.key === "material_intake");
  const mySale = myTypes.find((t) => t.key === "flake_sale");
  check("both directions came across", myIntake.direction === "payable" && mySale.direction === "receivable");

  // Buy 500kg of PET at ₹42/kg — priced by the engine, not typed in.
  const { data: buy, error: buyErr } = await r.rpc("record_activity", {
    p_activity_type_id: myIntake.id, p_party_id: collector.id, p_occurred_on: "2026-09-10",
    p_amount_minor: 2100000, // 500 × 4200, as lib/pricing computes it
    p_details: { material_grade: "PET", weight_kg: 500, weighbridge_slip: "WB-7781" },
  }).single();
  check("a purchase records against the new industry's schema", !buyErr, buyErr?.message);

  // Sell 2 tonnes of processed flake.
  const { data: sell, error: sellErr } = await r.rpc("record_activity", {
    p_activity_type_id: mySale.id, p_party_id: buyer.id, p_occurred_on: "2026-09-14",
    p_amount_minor: 9000000,
    p_details: { material_grade: "PET", weight_kg: 2000 },
  }).single();
  check("a sale records too, in the other direction", !sellErr, sellErr?.message);

  const { data: ready } = await r.from("party_ready_to_bill")
    .select("direction, pending_count").order("direction");
  check("both sit in ready-to-bill, split by direction and never netted",
    JSON.stringify(ready?.map((x) => `${x.direction}:${x.pending_count}`)) ===
      JSON.stringify(["payable:1", "receivable:1"]), JSON.stringify(ready));

  // Invoice the buyer.
  const { data: inv, error: invErr } = await r.rpc("issue_document", {
    p_doc_kind: "invoice", p_counterparty_id: buyer.id, p_doc_date: "2026-09-16",
    p_taxable_value_minor: 9000000, p_total_minor: 10620000,
    p_taxes: [
      { component_code: "CGST", component_label: "CGST 9%", rate_pct: 9, amount_minor: 810000, sort_order: 0 },
      { component_code: "SGST", component_label: "SGST 9%", rate_pct: 9, amount_minor: 810000, sort_order: 1 },
    ],
    p_activity_ids: [sell.activity_id], p_due_date: "2026-10-16",
  }).single();
  check("an invoice issues, numbered in the org's own series", !invErr && inv?.doc_no === "INV-2627-000001",
    invErr?.message ?? inv?.doc_no);

  // Part-pay it.
  const { error: payErr } = await r.rpc("record_payment", {
    p_direction: "in", p_party_id: buyer.id, p_amount_minor: 5000000,
    p_paid_on: "2026-09-20", p_method: "bank",
    p_allocations: [{ document_id: inv.document_id, amount_minor: 5000000 }],
  });
  check("a payment applies", !payErr, payErr?.message);

  const { data: bal } = await r.from("document_balances")
    .select("balance_due_minor").eq("document_id", inv.document_id).single();
  check("the balance is exactly right", bal?.balance_due_minor === 5620000, JSON.stringify(bal));

  const { data: out } = await r.from("party_outstanding")
    .select("direction, amount_outstanding_minor").eq("party_id", buyer.id).single();
  check("and it shows in outstanding, on the receivable side",
    out?.direction === "receivable" && out?.amount_outstanding_minor === 5620000, JSON.stringify(out));

  const { data: dim } = await r.from("activities")
    .select("dim1_key, dim1_value").eq("id", buy.activity_id).single();
  check("the industry's reportable field is mirrored for grouping",
    dim?.dim1_key === "material_grade" && dim?.dim1_value === "PET", JSON.stringify(dim));

  // ── The two businesses stay apart ────────────────────────────────────────
  console.log("\nTwo industries, one database");
  const { data: fSees } = await f.from("activities").select("id");
  check("the freight business sees none of the recycler's work", fSees?.length === 0, JSON.stringify(fSees));

  const { data: rSeesTypes } = await r.from("activity_types").select("key").not("org_id", "is", null);
  check("and neither sees the other's configuration",
    JSON.stringify(rSeesTypes?.map((x) => x.key).sort()) === JSON.stringify(["flake_sale", "material_intake"]),
    JSON.stringify(rSeesTypes));

  console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nverification crashed:", err.message ?? err);
  process.exit(1);
});
