/**
 * Phase 2 gate: proves the activity engine against a live database.
 *
 * The central claim of the architecture is that ONE schema serves genuinely
 * different industries. This records freight work and scrap-yard work side by
 * side in the same table, with different field schemas, and shows that the
 * database enforces each one's rules without knowing what either is.
 *
 *   npm run db:reset && node scripts/verify-activities.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let passed = 0;
const failures = [];

function check(label, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}\n      ${detail}`);
  }
}

function rejects(label, error, match) {
  const ok = Boolean(error) && new RegExp(match, "i").test(error.message);
  check(label, ok, error ? `got: ${error.message}` : "NO ERROR RAISED — bad data was accepted");
}

async function signUp(email) {
  const { data: users } = await admin.auth.admin.listUsers();
  for (const u of users.users) if (u.email === email) await admin.auth.admin.deleteUser(u.id);
  await admin.auth.admin.createUser({ email, email_confirm: true });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "email" });
  if (error) throw error;
  await client.auth.setSession(data.session);
  return client;
}


/**
 * PostgREST builds a bulk insert from the UNION of the keys across rows and
 * sends NULL — not DEFAULT — for any a given row omits. So a batch where one
 * row sets `options` and another doesn't makes the second fail its NOT NULL.
 * Every batched row must carry the full column set.
 */
function fieldRow(typeId, orgId, over) {
  return {
    activity_type_id: typeId,
    org_id: orgId,
    options: [],
    is_required: false,
    is_reportable: false,
    show_on_document: true,
    ...over,
  };
}

async function main() {
  console.log("\nMoonbook — Phase 2 activity engine\n");

  const db = await signUp("owner@phase2.test");
  const { data: org, error: orgErr } = await db
    .rpc("create_organisation", {
      p_legal_name: "Two Industries Ltd",
      p_country_code: "IN",
      p_base_currency: "INR",
      p_region_code: "KA",
      p_fiscal_year_start_month: 4,
      p_tax_regime: "split_rate",
      p_default_tax_rate_pct: 18,
    })
    .single();
  if (orgErr) throw orgErr;

  const { data: party } = await db
    .from("parties").insert({ org_id: org.org_id, name: "Counterparty Co" }).select("id").single();

  // ── Two activity types, genuinely different shapes ───────────────────────
  console.log("Two industries in one table");

  const { data: freight } = await db
    .from("activity_types")
    .insert({
      org_id: org.org_id, key: "trip", label_singular: "Trip", label_plural: "Trips",
      direction: "receivable", pricing_strategy: "manual", dim1_field_key: "route_type",
    })
    .select("id").single();

  const { error: ffErr } = await db.from("activity_fields").insert([
    fieldRow(freight.id, org.org_id, { key: "origin", label: "Origin", field_type: "text", is_required: true, sort_order: 0 }),
    fieldRow(freight.id, org.org_id, { key: "destination", label: "Destination", field_type: "text", is_required: true, sort_order: 1 }),
    fieldRow(freight.id, org.org_id, { key: "route_type", label: "Route type", field_type: "select", options: ["Local", "Long haul"], is_reportable: true, sort_order: 2 }),
  ]);
  if (ffErr) throw new Error(`freight fields: ${ffErr.message}`);

  const { data: intake } = await db
    .from("activity_types")
    .insert({
      org_id: org.org_id, key: "material_intake", label_singular: "Material intake", label_plural: "Material intakes",
      direction: "payable", pricing_strategy: "quantity_rate",
      pricing_config: { quantity_field: "weight_kg", rate_field: "rate_per_kg_minor" },
      dim1_field_key: "material_grade", uses_job_margin: false,
    })
    .select("id").single();

  const { error: ifErr } = await db.from("activity_fields").insert([
    fieldRow(intake.id, org.org_id, { key: "material_grade", label: "Material grade", field_type: "select", options: ["PET", "HDPE", "Mixed"], is_required: true, is_reportable: true, sort_order: 0 }),
    fieldRow(intake.id, org.org_id, { key: "weight_kg", label: "Weight (kg)", field_type: "number", is_required: true, sort_order: 1 }),
    fieldRow(intake.id, org.org_id, { key: "contaminated", label: "Contaminated", field_type: "boolean", sort_order: 2 }),
  ]);
  if (ifErr) throw new Error(`intake fields: ${ifErr.message}`);

  const { error: tripErr } = await db
    .rpc("record_activity", {
      p_activity_type_id: freight.id, p_party_id: party.id, p_occurred_on: "2026-09-10",
      p_amount_minor: 1180000,
      p_details: { origin: "Bengaluru", destination: "Chennai", route_type: "Long haul" },
    })
    .single();
  check("a freight activity records", !tripErr, tripErr?.message);

  const { data: load, error: loadErr } = await db
    .rpc("record_activity", {
      p_activity_type_id: intake.id, p_party_id: party.id, p_occurred_on: "2026-09-11",
      p_amount_minor: 2100000,
      p_details: { material_grade: "PET", weight_kg: 500, contaminated: false },
    })
    .single();
  check("a scrap intake records against a different schema", !loadErr, loadErr?.message);

  const { data: rows } = await db.from("activities").select("direction").order("occurred_on");
  check("the two land in one table with opposite directions",
    JSON.stringify(rows?.map((r) => r.direction)) === JSON.stringify(["receivable", "payable"]),
    JSON.stringify(rows));

  // ── The trigger enforces each schema ─────────────────────────────────────
  console.log("\nThe database enforces each industry's own rules");

  const bad = (details, typeId = intake.id) =>
    db.rpc("record_activity", {
      p_activity_type_id: typeId, p_party_id: party.id, p_occurred_on: "2026-09-12",
      p_amount_minor: 1000, p_details: details,
    }).single();

  rejects("an unknown key is refused",
    (await bad({ material_grade: "PET", weight_kg: 1, colour: "blue" })).error,
    '"colour" is not a field');

  rejects("a missing required field is refused, by label",
    (await bad({ weight_kg: 1 })).error, "Material grade is required");

  rejects("a string where a number is declared is refused",
    (await bad({ material_grade: "PET", weight_kg: "heavy" })).error, "must be a number");

  rejects("a value outside the option list is refused",
    (await bad({ material_grade: "PVC", weight_kg: 1 })).error, 'not an option');

  rejects("a string where a boolean is declared is refused",
    (await bad({ material_grade: "PET", weight_kg: 1, contaminated: "yes" })).error, "must be true or false");

  rejects("freight's own fields are refused on a scrap intake",
    (await bad({ origin: "Bengaluru", destination: "Chennai" })).error, "is not a field");

  // The trigger must hold even when the RPC is bypassed entirely — the whole
  // reason it exists. The service role ignores RLS, so this is the CSV-import
  // and SQL-console path.
  const { error: rawErr } = await admin.from("activities").insert({
    org_id: org.org_id, activity_type_id: intake.id, party_id: party.id,
    direction: "payable", currency: "INR", occurred_on: "2026-09-13",
    amount_minor: 1000, details: { nonsense: true },
  });
  rejects("a direct insert bypassing the RPC is still refused", rawErr, "is not a field");

  // ── Dimension mirroring ──────────────────────────────────────────────────
  console.log("\nThe reportable field is mirrored with its key");

  const { data: mirrored } = await db
    .from("activities").select("dim1_key, dim1_value").eq("id", load.activity_id).single();
  check("the value is mirrored for fast grouping",
    mirrored?.dim1_value === "PET", JSON.stringify(mirrored));
  check("the KEY is stored beside it, so history stays interpretable",
    mirrored?.dim1_key === "material_grade", JSON.stringify(mirrored));

  // Repoint the reportable field: existing rows are now stale, and detectably
  // so, because each records the key it was captured under.
  await db.from("activity_types").update({ dim1_field_key: "contaminated" }).eq("id", intake.id);
  const { data: stale } = await db
    .from("activities").select("dim1_key").eq("id", load.activity_id).single();
  check("after repointing, the old row is detectably stale rather than silently mixed",
    stale?.dim1_key === "material_grade", JSON.stringify(stale));

  const { data: rebuilt, error: rebuildErr } = await db
    .rpc("rebuild_dimensions", { p_activity_type_id: intake.id }).single();
  check("rebuild_dimensions reports how many rows it touched",
    !rebuildErr && rebuilt?.rebuilt_count === 1, rebuildErr?.message ?? JSON.stringify(rebuilt));

  const { data: fixed } = await db
    .from("activities").select("dim1_key, dim1_value").eq("id", load.activity_id).single();
  check("the row now carries the new key and value",
    fixed?.dim1_key === "contaminated" && fixed?.dim1_value === "false", JSON.stringify(fixed));

  const { data: again } = await db
    .rpc("rebuild_dimensions", { p_activity_type_id: intake.id }).single();
  check("running it again is a no-op, so it is safe to repeat", again?.rebuilt_count === 0, JSON.stringify(again));

  // ── Archived fields ──────────────────────────────────────────────────────
  console.log("\nArchived fields");

  await db.from("activity_fields")
    .update({ archived_at: new Date().toISOString() })
    .eq("activity_type_id", intake.id).eq("key", "contaminated");

  const { error: stillOkErr } = await db.rpc("record_activity", {
    p_activity_type_id: intake.id, p_party_id: party.id, p_occurred_on: "2026-09-14",
    p_amount_minor: 1000, p_details: { material_grade: "HDPE", weight_kg: 2, contaminated: true },
  }).single();
  check("a historical value for an archived field is still accepted", !stillOkErr, stillOkErr?.message);

  const { error: notRequiredErr } = await db.rpc("record_activity", {
    p_activity_type_id: intake.id, p_party_id: party.id, p_occurred_on: "2026-09-14",
    p_amount_minor: 1000, p_details: { material_grade: "HDPE", weight_kg: 2 },
  }).single();
  check("an archived field is no longer required", !notRequiredErr, notRequiredErr?.message);

  // ── Ready to bill, per direction ─────────────────────────────────────────
  console.log("\nReady to bill");
  const { data: ready } = await db
    .from("party_ready_to_bill").select("direction, pending_count").order("direction");
  check("pending work is grouped by direction, never netted",
    JSON.stringify(ready?.map((r) => r.direction)) === JSON.stringify(["payable", "receivable"]),
    JSON.stringify(ready));

  console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nverification crashed:", err.message ?? err);
  process.exit(1);
});
