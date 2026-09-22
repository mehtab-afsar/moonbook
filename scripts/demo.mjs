/**
 * Four businesses, ready to look at. No sign-up, no inbox.
 *
 * Creates one organisation per industry with real data in it, and prints
 * email+password credentials for each that sign in immediately at /login —
 * auth is email+password (see EmailSignIn.tsx), not a magic link, so there
 * is no Mailpit to open and no flow to sit through before reaching the thing
 * worth judging. (An earlier version of this script minted a magic link
 * instead; that stopped working when auth moved to email+password and
 * app/auth/callback/route.ts, the magic link's landing route, was removed.)
 *
 * Freight and scrap are forked verticals (see docs/ONTOLOGY.md) — after
 * their industry template is copied in, activate_vertical() moves them onto
 * logistics_ or plastics_ tables the same way a real signup does, so their demo org
 * actually lands on /logistics or /plastics rather than the shared engine.
 *
 * The point of running all four is that they are the SAME software. Open them
 * side by side: the activity form, the invoice, the PDF and the dashboard are
 * one implementation, and everything that differs between them is a row.
 *
 *   npm run db:reset && npm run demo
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const RUN = Date.now().toString(36);

async function signIn(local) {
  const email = `${local}+${RUN}@moonbook.test`;
  const password = `demo-${RUN}-pass`;
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`${email}: ${error.message}`);

  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error: pwErr } = await client.auth.signInWithPassword({ email, password });
  if (pwErr) throw pwErr;
  await client.auth.setSession(data.session);

  // Wait out the sub-second clock race between GoTrue's `iat` and PostgREST.
  for (let i = 0; i < 40; i++) {
    const { error: e } = await client.from("industry_templates").select("key").limit(1);
    if (!e) break;
    if (!/issued at future/i.test(e.message)) throw e;
    await new Promise((r) => setTimeout(r, 100));
  }

  return { email, password, client };
}

const COUNTRY = {
  IN: { currency: "INR", locale: "en-IN", tz: "Asia/Kolkata", fy: 4, regime: "split_rate", rate: 18, kind: "GSTIN" },
  GB: { currency: "GBP", locale: "en-GB", tz: "Europe/London", fy: 1, regime: "single_rate", rate: 20, kind: "VAT" },
};

// Mirrors TEMPLATE_VERTICAL in app/api/organisations/route.ts — the two
// templates that fork the org off the shared ledger at signup.
const TEMPLATE_VERTICAL = { freight: "logistics", scrap: "plastics" };

async function business({ local, name, template, country = "IN", region = "KA" }) {
  const c = COUNTRY[country];
  const { email, password, client } = await signIn(local);

  const { data: org, error } = await client.rpc("create_organisation", {
    p_legal_name: name, p_country_code: country, p_base_currency: c.currency,
    p_region_code: region, p_locale: c.locale, p_timezone: c.tz,
    p_fiscal_year_start_month: c.fy, p_tax_regime: c.regime,
    p_default_tax_rate_pct: c.rate,
    p_tax_id: `${region === "KA" ? "29" : "27"}ABCDE${RUN.slice(-4).toUpperCase()}1Z5`,
    p_tax_id_kind: c.kind,
  }).single();
  if (error) throw new Error(`${name}: ${error.message}`);

  const { error: tErr } = await client.rpc("apply_industry_template", { p_template_key: template });
  if (tErr) throw new Error(`${name} template: ${tErr.message}`);

  const vertical = TEMPLATE_VERTICAL[template];
  let dashboardPath = "/dashboard";
  if (vertical) {
    const { error: vErr } = await client.rpc("activate_vertical", { p_vertical: vertical });
    if (vErr) throw new Error(`${name} activate_vertical: ${vErr.message}`);
    dashboardPath = `/${vertical}/dashboard`;
  }

  return { email, password, client, orgId: org.org_id, name, dashboardPath };
}

const party = async (b, name, region = "KA", terms = 30) => {
  const { data, error } = await b.client.from("parties")
    .insert({ org_id: b.orgId, name, country_code: "IN", region_code: region, payment_terms_days: terms })
    .select("id").single();
  if (error) throw new Error(`${b.name} / ${name}: ${error.message}`);
  return data.id;
};

const typeId = async (b, key) => {
  const { data, error } = await b.client.from("activity_types")
    .select("id").not("org_id", "is", null).eq("key", key).single();
  if (error) throw new Error(`${b.name} / type ${key}: ${error.message}`);
  return data.id;
};

/** Amounts are computed server-side, so the API is the honest way in. */
async function record(b, { typeId: t, partyId, details, amountMinor, occurredOn, reference }) {
  const { data, error } = await b.client.rpc("record_activity", {
    p_activity_type_id: t, p_party_id: partyId, p_occurred_on: occurredOn,
    p_amount_minor: amountMinor, p_details: details, p_reference: reference,
    p_status: "completed",
  }).single();
  if (error) throw new Error(`${b.name} / record: ${error.message}`);
  return data.activity_id;
}

const money = (major) => Math.round(major * 100);

async function main() {
  const out = [];

  // ── Logistics — a forked vertical, its own table and RPC, not
  // activity_types/record_activity (see docs/ONTOLOGY.md). ─────────────────
  const freight = await business({
    local: "freight", name: "Sahyadri Roadlines", template: "freight",
  });
  const fCust = await party(freight, "Konkan Ceramics", "KA", 15);
  const fBroker = await party(freight, "Deccan Freight Brokers", "MH", 30);
  for (const [o, d, v, amt, date] of [
    ["Pune", "Nashik", "MH12AB1122", 38000, "2026-06-04"],
    ["Pune", "Aurangabad", "MH12CD3344", 30000, "2026-06-07"],
    ["Pune", "Kolhapur", "MH12EF5566", 24500, "2026-06-11"],
  ]) {
    const { error } = await freight.client.rpc("record_logistics_activity", {
      p_direction: "receivable", p_party_id: fCust, p_occurred_on: date,
      p_amount_minor: money(amt), p_origin: o, p_destination: d,
      p_vehicle_no: v, p_load_type: "Full truckload",
    }).single();
    if (error) throw new Error(`${freight.name} / record: ${error.message}`);
  }
  out.push({ ...freight, note: `2 customers, 3 trips` });
  void fBroker;

  // ── Scrap — same forking as freight, onto plastics_*. ───────────────────
  const scrap = await business({
    local: "scrap", name: "Nandi Recyclers", template: "scrap",
  });
  const collector = await party(scrap, "Ward 12 Collection Co-op", "KA", 7);
  const processor = await party(scrap, "Mysuru Polymers", "KA", 30);

  // Bought by weight — the amount is the product of two recorded fields.
  for (const [mat, kg, rate, slip] of [
    ["PET", 1840, 22, "WB-4412"],
    ["HDPE", 960, 28, "WB-4418"],
    ["Cardboard", 3200, 9, "WB-4421"],
  ]) {
    const { error } = await scrap.client.rpc("record_plastics_activity", {
      p_direction: "payable", p_party_id: collector, p_occurred_on: "2026-06-05",
      p_amount_minor: money(kg * rate), p_material: mat, p_net_weight_kg: kg,
      p_rate_per_kg_minor: money(rate), p_grade: "B", p_ticket_no: slip,
    }).single();
    if (error) throw new Error(`${scrap.name} / record: ${error.message}`);
  }
  for (const [mat, kg, rate] of [["PET flake", 1600, 48], ["HDPE flake", 820, 55]]) {
    const { error } = await scrap.client.rpc("record_plastics_activity", {
      p_direction: "receivable", p_party_id: processor, p_occurred_on: "2026-06-12",
      p_amount_minor: money(kg * rate), p_material: mat, p_net_weight_kg: kg,
      p_rate_per_kg_minor: money(rate), p_grade: "A", p_vehicle_no: "KA09XY7788",
    }).single();
    if (error) throw new Error(`${scrap.name} / record: ${error.message}`);
  }
  out.push({ ...scrap, note: "buys AND sells — 3 purchases, 2 sales" });

  // ── Hospitality ──────────────────────────────────────────────────────────
  const cafe = await business({
    local: "cafe", name: "Blue Tokai Annexe", template: "hospitality",
  });
  const corporate = await party(cafe, "Innosphere Ventures", "KA", 30);
  const order = await typeId(cafe, "order");
  for (const [type, covers, amt, date, ref] of [
    ["Catering", 40, 18500, "2026-06-03", "CAT-091"],
    ["Function", 120, 64000, "2026-06-09", "FN-014"],
    ["Account tab", null, 7250, "2026-06-14", "TAB-JUN"],
  ]) {
    await record(cafe, {
      typeId: order, partyId: corporate, occurredOn: date, amountMinor: money(amt),
      reference: ref,
      details: { order_type: type, served_on: date, ...(covers ? { covers } : {}) },
    });
  }
  out.push({ ...cafe, note: "account customers only — counter sales are a till's job" });

  // ── Wholesale ────────────────────────────────────────────────────────────
  const wholesale = await business({
    local: "wholesale", name: "Anand Trading Company", template: "wholesale",
  });
  const retailer = await party(wholesale, "Shree Provision Stores", "KA", 21);
  const goods = await typeId(wholesale, "goods_out");
  for (const [product, sku, units, price, pack] of [
    ["Refined sunflower oil", "OIL-SF-1L", 144, 132, "12 x 1L"],
    ["Toor dal", "PUL-TD-1K", 200, 148, "25kg sack"],
    ["Basmati rice", "RIC-BS-5K", 60, 520, "5kg bag"],
  ]) {
    await record(wholesale, {
      typeId: goods, partyId: retailer, occurredOn: "2026-06-10",
      amountMinor: money(units * price),
      details: { product, sku, units, unit_price: price, pack_size: pack },
    });
  }
  out.push({ ...wholesale, note: "3 products, one delivery — each is its own invoice line" });

  // ── Print ────────────────────────────────────────────────────────────────
  console.log(`\n  Four businesses, one codebase.\n`);
  for (const b of out) {
    console.log(`  ${b.name}`);
    console.log(`    ${b.note}`);
    console.log(`    ${APP}/login  →  ${b.email} / ${b.password}`);
    console.log(`    Lands on: ${APP}${b.dashboardPath}\n`);
  }
  console.log(`  Sign in with the email and password printed above — no inbox involved.\n`);
}

main().catch((e) => { console.error("\n ", e.message, "\n"); process.exit(1); });
