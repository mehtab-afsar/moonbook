/**
 * Phase 1 gate: proves the ledger is correct against a live database.
 *
 * The static guards in __tests__ check the SHAPE of the schema without a
 * database. These checks need a real one, because what they assert is
 * arithmetic and concurrency behaviour, not text.
 *
 *   npx supabase start && npm run db:reset
 *   node scripts/verify-ledger.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

let passed = 0;
const failures = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push({ label, actual, expected });
    console.log(`  ✗ ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  }
}

function checkThrows(label, error, expectMatch) {
  if (error && new RegExp(expectMatch, "i").test(error.message)) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push({ label, actual: error?.message ?? "no error raised", expected: `error matching /${expectMatch}/` });
    console.log(`  ✗ ${label}\n      expected error matching /${expectMatch}/\n      actual   ${error?.message ?? "NO ERROR RAISED"}`);
  }
}

/** Sign in as a fresh user and return an authenticated client. */
async function signUp(email, fullName) {
  const existing = await admin.auth.admin.listUsers();
  for (const u of existing.data.users) {
    if (u.email === email) await admin.auth.admin.deleteUser(u.id);
  }
  await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await client.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email",
  });
  if (error) throw error;
  await client.auth.setSession(data.session);
  return client;
}

async function main() {
  console.log("\nMoonbook — Phase 1 ledger verification\n");

  // ── Org A: India, April financial year, split-rate GST ────────────────────
  console.log("Setup");
  const a = await signUp("owner@orga.test", "Owner A");
  const { data: orgA, error: orgAErr } = await a
    .rpc("create_organisation", {
      p_legal_name: "Alpha Freight Pvt Ltd",
      p_country_code: "IN",
      p_base_currency: "INR",
      p_region_code: "KA",
      p_locale: "en-IN",
      p_timezone: "Asia/Kolkata",
      p_fiscal_year_start_month: 4,
      p_tax_regime: "split_rate",
      p_default_tax_rate_pct: 18,
      p_invoice_prefix: "INV",
    })
    .single();
  if (orgAErr) throw orgAErr;
  console.log(`  org A ${orgA.org_id}`);

  const { data: party, error: partyErr } = await a
    .from("parties")
    .insert({ org_id: orgA.org_id, name: "Kaveri Textiles", country_code: "IN", region_code: "KA" })
    .select("id")
    .single();
  if (partyErr) throw partyErr;

  const { data: type, error: typeErr } = await a
    .from("activity_types")
    .insert({
      org_id: orgA.org_id,
      key: "trip",
      label_singular: "Trip",
      label_plural: "Trips",
      direction: "receivable",
      pricing_strategy: "manual",
      dim1_field_key: "service_type",
    })
    .select("id")
    .single();
  if (typeErr) throw typeErr;

  // Declare the fields this type records. Since Phase 2, the database rejects
  // any details key that no field definition covers — so a test that sends
  // details must say what they are, exactly as the app does.
  const { error: fieldsErr } = await a.from("activity_fields").insert(
    [
      { key: "service_type", label: "Service type", field_type: "text", sort_order: 0 },
      { key: "origin", label: "Origin", field_type: "text", sort_order: 1 },
      { key: "destination", label: "Destination", field_type: "text", sort_order: 2 },
    ].map((f) => ({
      activity_type_id: type.id,
      org_id: orgA.org_id,
      options: [],
      is_required: false,
      is_reportable: false,
      show_on_document: true,
      ...f,
    })),
  );
  if (fieldsErr) throw fieldsErr;

  // ── 1. Balance arithmetic ────────────────────────────────────────────────
  console.log("\n1. Balance arithmetic");
  const { data: act, error: actErr } = await a
    .rpc("record_activity", {
      p_activity_type_id: type.id,
      p_party_id: party.id,
      p_occurred_on: "2026-09-10",
      p_amount_minor: 1000000, // ₹10,000.00
      p_reference: "SO-2200",
      p_details: { service_type: "Freight", origin: "Bengaluru", destination: "Chennai" },
    })
    .single();
  if (actErr) throw actErr;

  const { data: doc, error: docErr } = await a
    .rpc("issue_document", {
      p_doc_kind: "invoice",
      p_counterparty_id: party.id,
      p_doc_date: "2026-09-16",
      p_taxable_value_minor: 1000000,
      p_total_minor: 1180000, // 10,000 + 9% + 9%
      p_taxes: [
        { component_code: "CGST", component_label: "CGST 9%", rate_pct: 9, amount_minor: 90000, sort_order: 0 },
        { component_code: "SGST", component_label: "SGST 9%", rate_pct: 9, amount_minor: 90000, sort_order: 1 },
      ],
      p_activity_ids: [act.activity_id],
      p_due_date: "2026-10-16",
    })
    .single();
  if (docErr) throw docErr;
  check("invoice number uses the April-start financial year", doc.doc_no, "INV-2627-000001");

  const bal = async (id) => {
    const { data } = await a.from("document_balances").select("balance_due_minor").eq("document_id", id).single();
    return data?.balance_due_minor ?? null;
  };
  check("balance before payment is the full total", await bal(doc.document_id), 1180000);

  const { error: payErr } = await a.rpc("record_payment", {
    p_direction: "in",
    p_party_id: party.id,
    p_amount_minor: 500000,
    p_paid_on: "2026-09-20",
    p_method: "bank",
    p_allocations: [{ document_id: doc.document_id, amount_minor: 500000 }],
  });
  if (payErr) throw payErr;
  check("balance after a ₹5,000 part-payment", await bal(doc.document_id), 680000);

  const { data: tax } = await a
    .from("document_taxes")
    .select("component_code, amount_minor")
    .eq("document_id", doc.document_id)
    .order("sort_order");
  check("tax stored as two components, not fixed columns", tax, [
    { component_code: "CGST", amount_minor: 90000 },
    { component_code: "SGST", amount_minor: 90000 },
  ]);

  // ── 2. A balance can never go negative ───────────────────────────────────
  console.log("\n2. Over-allocation is refused");
  const { error: overErr } = await a.rpc("record_payment", {
    p_direction: "in",
    p_party_id: party.id,
    p_amount_minor: 900000,
    p_paid_on: "2026-09-21",
    p_method: "bank",
    p_allocations: [{ document_id: doc.document_id, amount_minor: 900000 }],
  });
  checkThrows("allocating more than is owed is rejected", overErr, "exceeds the .* still owed");
  check("balance is unchanged after the refused attempt", await bal(doc.document_id), 680000);

  const { data: negatives } = await a
    .from("document_balances")
    .select("document_id")
    .lt("balance_due_minor", 0);
  check("no document anywhere has a negative balance", negatives, []);

  // ── 3. Back-dating across the financial-year boundary ────────────────────
  console.log("\n3. Back-dated documents take the correct year's series");
  const { data: backAct } = await a
    .rpc("record_activity", {
      p_activity_type_id: type.id,
      p_party_id: party.id,
      p_occurred_on: "2026-03-10",
      p_amount_minor: 200000,
      p_details: { service_type: "Freight" },
    })
    .single();
  const { data: backDoc, error: backErr } = await a
    .rpc("issue_document", {
      p_doc_kind: "invoice",
      p_counterparty_id: party.id,
      p_doc_date: "2026-03-15", // before 1 April → previous financial year
      p_taxable_value_minor: 200000,
      p_total_minor: 200000,
      p_activity_ids: [backAct.activity_id],
    })
    .single();
  if (backErr) throw backErr;
  check("a March document lands in FY 2025-26, not the current year", backDoc.doc_no, "INV-2526-000001");

  // ── 4. Cancelling ────────────────────────────────────────────────────────
  console.log("\n4. Cancellation");
  const { error: cancelPaidErr } = await a.rpc("cancel_document", {
    p_document_id: doc.document_id,
    p_reason: "customer disputed",
  });
  checkThrows("cancelling a document with money applied is refused", cancelPaidErr, "already been applied");

  const { error: cancelErr } = await a.rpc("cancel_document", {
    p_document_id: backDoc.document_id,
    p_reason: "raised in error",
  });
  check("an unpaid document cancels cleanly", cancelErr, null);

  const { data: released } = await a
    .from("activities")
    .select("status")
    .eq("id", backAct.activity_id)
    .single();
  check("cancelling releases the activity it billed", released.status, "completed");

  // The bug LedgerFlow has: its duplicate-check ignores the parent invoice's
  // status, so released work could never actually be re-billed.
  const { data: rebill, error: rebillErr } = await a
    .rpc("issue_document", {
      p_doc_kind: "invoice",
      p_counterparty_id: party.id,
      p_doc_date: "2026-03-15",
      p_taxable_value_minor: 200000,
      p_total_minor: 200000,
      p_activity_ids: [backAct.activity_id],
    })
    .single();
  check("released work can genuinely be re-billed", rebillErr, null);
  check("the re-bill takes the next number in that year's series", rebill?.doc_no, "INV-2526-000002");

  // ── 5. Tenant isolation ──────────────────────────────────────────────────
  console.log("\n5. Tenant isolation");
  const b = await signUp("owner@orgb.test", "Owner B");
  const { error: orgBErr } = await b
    .rpc("create_organisation", {
      p_legal_name: "Bravo Logistics Ltd",
      p_country_code: "GB",
      p_base_currency: "GBP",
      p_locale: "en-GB",
      p_timezone: "Europe/London",
      p_fiscal_year_start_month: 1,
      p_tax_regime: "single_rate",
      p_default_tax_rate_pct: 20,
    })
    .single();
  if (orgBErr) throw orgBErr;

  const { data: bDocs } = await b.from("document_balances").select("document_id");
  check("org B sees none of org A's document balances", bDocs, []);

  const { data: bOut } = await b.from("party_outstanding").select("party_id");
  check("org B sees none of org A's outstanding", bOut, []);

  const { data: bParties } = await b.from("parties").select("id");
  check("org B sees none of org A's parties", bParties, []);

  const { data: bDirect } = await b
    .from("documents")
    .select("id")
    .eq("id", doc.document_id);
  check("a direct fetch of org A's document by id returns nothing", bDirect, []);

  const { error: bAllocErr } = await b.rpc("allocate", {
    p_target_document_id: doc.document_id,
    p_amount_minor: 100,
    p_payment_id: null,
    p_credit_document_id: null,
  });
  checkThrows("org B cannot allocate against org A's document", bAllocErr, "exactly one of a payment or a credit document|not found");

  // ── 6. A second country, same code path ──────────────────────────────────
  console.log("\n6. A second country in the same database");
  const { data: bOrg } = await b.from("organisations").select("id, base_currency, fiscal_year_start_month").single();
  const { data: bParty } = await b
    .from("parties")
    .insert({ org_id: bOrg.id, name: "Thames Freight Ltd", country_code: "GB" })
    .select("id")
    .single();
  const { data: bType } = await b
    .from("activity_types")
    .insert({
      org_id: bOrg.id, key: "job", label_singular: "Job", label_plural: "Jobs",
      direction: "receivable", pricing_strategy: "manual",
    })
    .select("id")
    .single();
  const { data: bAct } = await b
    .rpc("record_activity", {
      p_activity_type_id: bType.id,
      p_party_id: bParty.id,
      p_occurred_on: "2026-09-10",
      p_amount_minor: 100000, // £1,000.00
    })
    .single();
  const { data: bInv, error: bInvErr } = await b
    .rpc("issue_document", {
      p_doc_kind: "invoice",
      p_counterparty_id: bParty.id,
      p_doc_date: "2026-09-16",
      p_taxable_value_minor: 100000,
      p_total_minor: 120000,
      p_taxes: [{ component_code: "VAT", component_label: "VAT 20%", rate_pct: 20, amount_minor: 20000 }],
      p_activity_ids: [bAct.activity_id],
    })
    .single();
  if (bInvErr) throw bInvErr;
  check("a calendar-year org numbers by calendar year", bInv.doc_no, "INV-2026-000001");

  const { data: bTax } = await b
    .from("document_taxes")
    .select("component_code, amount_minor")
    .eq("document_id", bInv.document_id);
  check("one VAT component from the same code path that produced two GST ones", bTax, [
    { component_code: "VAT", amount_minor: 20000 },
  ]);

  const { data: bBal } = await b
    .from("document_balances")
    .select("currency, balance_due_minor")
    .eq("document_id", bInv.document_id)
    .single();
  check("balances carry their own currency", bBal, { currency: "GBP", balance_due_minor: 120000 });

  // ── Result ───────────────────────────────────────────────────────────────
  console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nverification crashed:", err.message ?? err);
  process.exit(1);
});
