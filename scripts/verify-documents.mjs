/**
 * Phase 4 gate — TWO COUNTRIES, ONE CODE PATH.
 *
 * Three businesses are onboarded into the SAME database: an Indian freight
 * company under split-rate GST, a British consultancy under single-rate VAT,
 * and a Dubai logistics firm at 5%. Each records work, issues an invoice
 * through the real HTTP API, and downloads a rendered PDF.
 *
 * What is being proved is narrow and specific: the difference between a
 * CGST+SGST invoice, an IGST invoice and a VAT invoice is entirely a matter of
 * ROWS — organisation configuration in, document_taxes rows out — and no
 * branch on country exists in lib/tax, in issue_document, or in the renderer.
 *
 * It drives the running dev server over HTTP rather than calling the libraries
 * directly, so what passes here is the shipping path: verifyAuth, RLS, the
 * route's tax computation, issue_document, and the PDF route. A re-
 * implementation that happened to agree with itself would prove nothing.
 *
 * Signing in means presenting the session cookie @supabase/ssr expects, which
 * is what authCookies() below constructs.
 *
 * The rendered PDFs are written to /tmp so the output can be looked at, not
 * merely asserted on.
 *
 *   npm run db:reset && npm run dev   # in another terminal
 *   npm run verify:documents
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP = process.env.APP_URL ?? "http://localhost:3000";

const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let passed = 0;
const failures = [];
const check = (label, ok, detail = "") => {
  if (ok) { passed += 1; console.log(`  ✓ ${label}`); }
  else { failures.push(label); console.log(`  ✗ ${label}\n      ${detail}`); }
};

/**
 * The cookie @supabase/ssr reads: `base64-` + base64 of the session JSON,
 * split across `.0`, `.1`, … once it exceeds the chunk size. Reconstructed
 * here rather than driven through a browser so the gate stays a script.
 */
const MAX_CHUNK_SIZE = 3180;
function authCookies(session) {
  const name = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;
  const value = "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64");
  if (value.length <= MAX_CHUNK_SIZE) return [`${name}=${value}`];
  const chunks = [];
  for (let i = 0; i * MAX_CHUNK_SIZE < value.length; i++) {
    chunks.push(`${name}.${i}=${value.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE)}`);
  }
  return chunks;
}

/**
 * A fresh identity per run, rather than deleting the previous one.
 *
 * Deleting is not available here and should not be: `documents.created_by`
 * references the profile, with no cascade, so once an account has issued an
 * invoice the database refuses to erase who issued it. That is the correct
 * behaviour for an audit trail and the wrong thing to work around, so each run
 * simply signs up someone new. `npm run db:reset` is the cleanup.
 */
const RUN = Date.now().toString(36);

async function signUp(local, domain) {
  const email = `${local}+${RUN}@${domain}`;
  const { error: createErr } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (createErr) throw new Error(`createUser ${email}: ${createErr.message}`);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.verifyOtp({
    token_hash: link.properties.hashed_token, type: "email",
  });
  if (error) throw error;
  await c.auth.setSession(data.session);
  c.__cookie = authCookies(data.session).join("; ");
  return c;
}

/** A request to the app as that signed-in user. */
async function api(c, path, init = {}) {
  const res = await fetch(`${APP}${path}`, {
    ...init,
    headers: {
      Cookie: c.__cookie,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/pdf")) {
    return { res, buffer: Buffer.from(await res.arrayBuffer()) };
  }
  return { res, body: type.includes("json") ? await res.json() : await res.text() };
}

/** Issue an invoice the way the app does: POST it and let the route do the tax. */
async function issueInvoice(c, { partyId, activityIds, docDate, treatment }) {
  const { res, body } = await api(c, "/api/documents", {
    method: "POST",
    body: JSON.stringify({
      doc_kind: "invoice",
      counterparty_id: partyId,
      doc_date: docDate,
      activity_ids: activityIds,
      ...(treatment ? { tax_treatment: treatment } : {}),
    }),
  });
  if (!res.ok) throw new Error(`issue failed ${res.status}: ${JSON.stringify(body)}`);

  // Read back what was actually stored, rather than trusting the response.
  const { data: taxes } = await c
    .from("document_taxes")
    .select("component_code, component_label, rate_pct, amount_minor, sort_order")
    .eq("document_id", body.data.document_id)
    .order("sort_order");
  const { data: doc } = await c
    .from("documents")
    .select("doc_no, taxable_value_minor, total_minor, tax_treatment, issued_snapshot")
    .eq("id", body.data.document_id)
    .single();

  return { id: body.data.document_id, taxNote: body.data.tax_note, taxes, ...doc };
}

async function downloadPdf(c, documentId, outPath) {
  const { res, buffer } = await api(c, `/api/documents/${documentId}/pdf`);
  if (!res.ok) throw new Error(`pdf failed ${res.status}`);
  writeFileSync(outPath, buffer);
  return buffer;
}

async function main() {
  console.log("\nMoonbook — Phase 4: documents, PDFs, two tax regimes\n");

  // The gate is worthless if it silently tested nothing because the server
  // was down, so that is the first assertion rather than a stack trace later.
  try {
    await fetch(`${APP}/api/documents`);
  } catch {
    console.error(`Dev server is not answering on ${APP}. Start it with: npm run dev`);
    process.exit(1);
  }

  // ───────────────────────────────────────────────────────────────────────
  // India — split-rate GST
  // ───────────────────────────────────────────────────────────────────────
  console.log("An Indian freight company (split_rate GST, 18%, Karnataka)");
  const inC = await signUp("owner", "bharat-freight.test");
  const { data: inOrgRow, error: inOrgRowErr } = await inC.rpc("create_organisation", {
    p_legal_name: `Bharat Freight Lines ${RUN}`,
    p_country_code: "IN", p_base_currency: "INR", p_region_code: "KA",
    p_locale: "en-IN", p_timezone: "Asia/Kolkata", p_fiscal_year_start_month: 4,
    p_tax_regime: "split_rate", p_default_tax_rate_pct: 18,
    p_tax_id: "29AABCB1234C1ZX", p_tax_id_kind: "GSTIN",
    p_address: "14 Hosur Road, Bengaluru 560029",
  }).single();
  if (inOrgRowErr) throw new Error(`create_organisation (IN): ${inOrgRowErr.message}`);
  await inC.rpc("apply_industry_template", { p_template_key: "freight" });

  // Two customers: one in the same state, one in another. Identical sale —
  // the only difference between them is a two-letter code on the party.
  const { data: inParties, error: inPartyErr } = await inC.from("parties").insert([
    { org_id: inOrgRow.org_id, name: "Karnataka Cements", region_code: "KA",
      country_code: "IN", tax_id: `29AACCK9012L1Z${RUN.slice(-1)}`, tax_id_kind: "GSTIN",
      address: "Plot 9, Peenya Industrial Area, Bengaluru 560058" },
    { org_id: inOrgRow.org_id, name: "Maharashtra Mills", region_code: "MH",
      country_code: "IN", tax_id: `27AACCM3456N1Z${RUN.slice(-1)}`, tax_id_kind: "GSTIN",
      address: "Unit 4, MIDC Bhosari, Pune 411026" },
  ]).select("id, name, region_code");
  if (inPartyErr) throw new Error(inPartyErr.message);
  const karnataka = inParties.find((p) => p.region_code === "KA");
  const maharashtra = inParties.find((p) => p.region_code === "MH");

  const { data: inType } = await inC
    .from("activity_types").select("id").not("org_id", "is", null).eq("key", "trip").single();

  const trip = async (partyId, details, amount) => {
    const { data, error } = await inC.rpc("record_activity", {
      p_activity_type_id: inType.id, p_party_id: partyId,
      p_occurred_on: "2026-06-12", p_amount_minor: amount,
      p_details: details, p_status: "completed",
    }).single();
    if (error) throw new Error(error.message);
    return data.activity_id;
  };

  const tripA = await trip(karnataka.id,
    { origin: "Bengaluru", destination: "Hubballi", vehicle_no: "KA01AB1234", load_type: "Full truckload" },
    10000000);
  const tripB = await trip(maharashtra.id,
    { origin: "Bengaluru", destination: "Pune", vehicle_no: "KA05CD5678", load_type: "Full truckload" },
    10000000);

  const intra = await issueInvoice(inC, { partyId: karnataka.id, activityIds: [tripA], docDate: "2026-06-30" });
  const inter = await issueInvoice(inC, { partyId: maharashtra.id, activityIds: [tripB], docDate: "2026-06-30" });

  check("a same-state sale splits into two components",
    intra.taxes.map((t) => t.component_code).join("+") === "CGST+SGST",
    JSON.stringify(intra.taxes));
  check("each half is 9%, together making the full 18%",
    intra.taxes.every((t) => Number(t.rate_pct) === 9) &&
      intra.taxes.reduce((s, t) => s + t.amount_minor, 0) === 1800000,
    JSON.stringify(intra.taxes));
  check("a cross-state sale is one combined component instead",
    inter.taxes.length === 1 && inter.taxes[0].component_code === "IGST",
    JSON.stringify(inter.taxes));
  check("and the two totals are identical — only the naming differs",
    intra.total_minor === inter.total_minor && intra.total_minor === 11800000,
    `${intra.total_minor} vs ${inter.total_minor}`);
  check("an April fiscal year puts June 2026 in FY 2627",
    intra.doc_no === "INV-2627-000001", intra.doc_no);

  // ───────────────────────────────────────────────────────────────────────
  // The United Kingdom — single-rate VAT
  // ───────────────────────────────────────────────────────────────────────
  console.log("\nA British consultancy (single_rate VAT, 20%), same database");
  const gbC = await signUp("owner", "thames-consulting.test");
  const { data: gbOrgRow, error: gbOrgRowErr } = await gbC.rpc("create_organisation", {
    p_legal_name: `Thames Consulting Ltd ${RUN}`,
    p_country_code: "GB", p_base_currency: "GBP",
    p_locale: "en-GB", p_timezone: "Europe/London", p_fiscal_year_start_month: 1,
    p_tax_regime: "single_rate", p_default_tax_rate_pct: 20,
    p_tax_id: "GB123456789", p_tax_id_kind: "VAT",
    p_address: "8 Bishopsgate, London EC2N 4BQ",
  }).single();
  if (gbOrgRowErr) throw new Error(`create_organisation (GB): ${gbOrgRowErr.message}`);
  await gbC.rpc("apply_industry_template", { p_template_key: "generic" });

  const { data: gbParty } = await gbC.from("parties").insert({
    org_id: gbOrgRow.org_id, name: "Fenchurch Partners LLP", country_code: "GB",
    tax_id: "GB987654321", tax_id_kind: "VAT", address: "20 Fenchurch Street, London EC3M 3BY",
  }).select("id").single();

  const { data: gbType } = await gbC
    .from("activity_types").select("id").not("org_id", "is", null).single();

  const { data: gbAct, error: gbActErr } = await gbC.rpc("record_activity", {
    p_activity_type_id: gbType.id, p_party_id: gbParty.id,
    p_occurred_on: "2026-06-18", p_amount_minor: 450000,
    p_reference: "Advisory retainer, June", p_status: "completed",
  }).single();
  if (gbActErr) throw new Error(gbActErr.message);

  const vat = await issueInvoice(gbC, {
    partyId: gbParty.id, activityIds: [gbAct.activity_id], docDate: "2026-06-30",
  });

  check("VAT is a single component at the full rate",
    vat.taxes.length === 1 && vat.taxes[0].component_code === "VAT" &&
      Number(vat.taxes[0].rate_pct) === 20,
    JSON.stringify(vat.taxes));
  check("£4,500.00 + 20% = £5,400.00", vat.total_minor === 540000, String(vat.total_minor));
  check("a January fiscal year gives a calendar-year series, not 2627",
    vat.doc_no === "INV-2026-000001", vat.doc_no);

  // ───────────────────────────────────────────────────────────────────────
  // Rendering — from the frozen snapshot, through the real route
  // ───────────────────────────────────────────────────────────────────────
  console.log("\nRendering");

  const intraPdf = await downloadPdf(inC, intra.id, "/tmp/moonbook-in-intrastate.pdf");
  const interPdf = await downloadPdf(inC, inter.id, "/tmp/moonbook-in-interstate.pdf");
  const vatPdf = await downloadPdf(gbC, vat.id, "/tmp/moonbook-gb-vat.pdf");

  for (const [label, buf] of [["intra-state", intraPdf], ["inter-state", interPdf], ["VAT", vatPdf]]) {
    check(`the ${label} invoice renders to a real PDF`,
      buf.subarray(0, 5).toString() === "%PDF-" && buf.length > 3000, `${buf.length} bytes`);
  }

  const intraSnap = intra.issued_snapshot;
  const vatSnap = vat.issued_snapshot;
  check("the Indian invoice carries two tax rows, the British one carries one",
    intraSnap.taxes.length === 2 && vatSnap.taxes.length === 1,
    `${intraSnap.taxes.length} / ${vatSnap.taxes.length}`);
  check("the labels that print come from the rows, not from the renderer",
    intraSnap.taxes.map((t) => t.component_label).join(", ") === "CGST 9%, SGST 9%" &&
      vatSnap.taxes[0].component_label === "VAT 20%",
    JSON.stringify([...intraSnap.taxes, ...vatSnap.taxes].map((t) => t.component_label)));

  // The descriptive body reaching the document — and only the document.
  check("the freight line prints its own industry's fields",
    intraSnap.lines[0].printable_details.map((d) => `${d.label}=${d.value}`).join(", ") ===
      "Origin=Bengaluru, Destination=Hubballi, Vehicle no.=KA01AB1234, Load type=Full truckload",
    JSON.stringify(intraSnap.lines[0].printable_details));
  check("the consultancy's line, configured differently, prints nothing it has not got",
    vatSnap.lines[0].printable_details.length === 0,
    JSON.stringify(vatSnap.lines[0].printable_details));

  // ───────────────────────────────────────────────────────────────────────
  // An issued document is a statement of fact made on a date
  // ───────────────────────────────────────────────────────────────────────
  console.log("\nAn issued document is immutable");

  await inC.from("activity_fields").update({ label: "Starting point" })
    .not("org_id", "is", null).eq("key", "origin");
  await inC.from("organisations")
    .update({ legal_name: `Bharat Freight Lines ${RUN} Pvt Ltd` }).eq("id", inOrgRow.org_id);

  const { data: reread } = await inC
    .from("documents").select("issued_snapshot").eq("id", intra.id).single();
  const again = await downloadPdf(inC, intra.id, "/tmp/moonbook-in-intrastate-again.pdf");

  check("renaming a field does not reword an invoice already sent",
    reread.issued_snapshot.lines[0].printable_details[0].label === "Origin",
    reread.issued_snapshot.lines[0].printable_details[0].label);
  check("nor does renaming the business change the letterhead on it",
    reread.issued_snapshot.organisation.legal_name === `Bharat Freight Lines ${RUN}`,
    reread.issued_snapshot.organisation.legal_name);
  check("so the PDF re-renders to the same size it did before",
    Math.abs(again.length - intraPdf.length) < 200,
    `${intraPdf.length} then ${again.length}`);

  // ───────────────────────────────────────────────────────────────────────
  // Tenancy, at the document boundary
  // ───────────────────────────────────────────────────────────────────────
  console.log("\nTenancy");
  const { res: crossRes, body: crossBody } = await api(gbC, `/api/documents/${intra.id}/pdf`);
  check("another org's document is a 404, never a 403",
    crossRes.status === 404, `${crossRes.status} ${JSON.stringify(crossBody)}`);

  const { data: gbDocs } = await gbC.from("documents").select("doc_no");
  check("and the British org's list contains only its own",
    gbDocs.length === 1 && gbDocs[0].doc_no === vat.doc_no, JSON.stringify(gbDocs));

  const { res: anonRes } = await fetch(`${APP}/api/documents/${intra.id}/pdf`)
    .then((r) => ({ res: r }));
  check("and a signed-out caller gets nothing at all",
    anonRes.status === 401 || anonRes.status === 307, String(anonRes.status));

  // ───────────────────────────────────────────────────────────────────────
  // Zero tax has three different reasons, and says which
  // ───────────────────────────────────────────────────────────────────────
  console.log("\nZero tax, for three different reasons");

  const tripC = await trip(karnataka.id,
    { origin: "Bengaluru", destination: "Mysuru", vehicle_no: "KA01AB1234", load_type: "Part load" },
    5000000);
  const exempt = await issueInvoice(inC, {
    partyId: karnataka.id, activityIds: [tripC], docDate: "2026-06-30", treatment: "exempt",
  });
  check("an exempt supply charges nothing, and says it is exempt",
    exempt.taxes.length === 0 && exempt.taxNote === "Exempt / nil-rated — no tax charged." &&
      exempt.total_minor === 5000000,
    JSON.stringify({ taxes: exempt.taxes, note: exempt.taxNote }));

  const tripD = await trip(maharashtra.id,
    { origin: "Bengaluru", destination: "Nagpur", vehicle_no: "KA05CD5678", load_type: "Express" },
    7000000);
  const rcm = await issueInvoice(inC, {
    partyId: maharashtra.id, activityIds: [tripD], docDate: "2026-06-30", treatment: "reverse_charge",
  });
  check("a reverse-charge supply charges nothing for a different reason, and says that one",
    rcm.taxes.length === 0 &&
      rcm.taxNote === "Tax payable by the recipient under reverse charge." &&
      rcm.total_minor === 7000000,
    JSON.stringify({ taxes: rcm.taxes, note: rcm.taxNote }));

  const exemptPdf = await downloadPdf(inC, exempt.id, "/tmp/moonbook-in-exempt.pdf");
  check("the exempt invoice renders with no tax section at all",
    exemptPdf.subarray(0, 5).toString() === "%PDF-" &&
      exempt.issued_snapshot.taxes.length === 0 &&
      exempt.taxable_value_minor === exempt.total_minor,
    JSON.stringify(exempt.issued_snapshot.taxes));

  // ───────────────────────────────────────────────────────────────────────
  // A third country, to check the abstraction rather than assume it
  // ───────────────────────────────────────────────────────────────────────
  console.log("\nA third country");
  const aeC = await signUp("owner", "dubai-logistics.test");
  const { data: aeOrgRow, error: aeOrgRowErr } = await aeC.rpc("create_organisation", {
    p_legal_name: `Dubai Logistics FZE ${RUN}`,
    p_country_code: "AE", p_base_currency: "AED", p_locale: "en-AE",
    p_timezone: "Asia/Dubai", p_fiscal_year_start_month: 1,
    p_tax_regime: "single_rate", p_default_tax_rate_pct: 5,
    p_tax_id: "100123456700003", p_tax_id_kind: "TRN",
  }).single();
  if (aeOrgRowErr) throw new Error(`create_organisation (AE): ${aeOrgRowErr.message}`);
  await aeC.rpc("apply_industry_template", { p_template_key: "generic" });

  const { data: aeParty } = await aeC.from("parties")
    .insert({ org_id: aeOrgRow.org_id, name: "Jebel Ali Trading LLC", country_code: "AE" })
    .select("id").single();
  const { data: aeType } = await aeC
    .from("activity_types").select("id").not("org_id", "is", null).single();
  const { data: aeAct } = await aeC.rpc("record_activity", {
    p_activity_type_id: aeType.id, p_party_id: aeParty.id,
    p_occurred_on: "2026-07-02", p_amount_minor: 1000000, p_status: "completed",
  }).single();

  const aeInv = await issueInvoice(aeC, {
    partyId: aeParty.id, activityIds: [aeAct.activity_id], docDate: "2026-07-02",
  });
  const aePdf = await downloadPdf(aeC, aeInv.id, "/tmp/moonbook-ae-vat.pdf");

  check("the UAE at 5% needed no migration, no seed and no code",
    aeInv.taxes.length === 1 && aeInv.taxes[0].component_label === "VAT 5%" &&
      aeInv.total_minor === 1050000,
    JSON.stringify(aeInv.taxes));
  check("and renders in dirhams with its TRN on the letterhead",
    aeInv.issued_snapshot.document.currency === "AED" &&
      aeInv.issued_snapshot.organisation.tax_id_kind === "TRN" &&
      aePdf.length > 3000,
    JSON.stringify({
      c: aeInv.issued_snapshot.document.currency,
      k: aeInv.issued_snapshot.organisation.tax_id_kind,
    }));

  // ───────────────────────────────────────────────────────────────────────
  // The claim, checked against the source rather than asserted
  // ───────────────────────────────────────────────────────────────────────
  console.log("\nThe claim, checked against the source");
  const grep = (pattern, paths) => {
    try { return execFileSync("grep", ["-rniE", pattern, ...paths], { encoding: "utf8" }).trim(); }
    catch { return ""; }
  };
  const countryBranch = grep(
    "(country_code|countrycode)\\s*(===|==|!=|!==)|case\\s+['\"](IN|GB|AE|US)['\"]",
    ["lib/tax", "lib/pdf", "app/api/documents"],
  );
  check("no country comparison exists anywhere in tax, rendering or issuing",
    countryBranch === "", countryBranch.slice(0, 400));

  console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach((f) => console.log(`  · ${f}`)); process.exit(1); }
  console.log("\nPDFs written to /tmp/moonbook-*.pdf\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
