import { test, expect } from "./fixtures";
import { addParty, activityTypeId, recordActivity, issueInvoice, trip } from "./helpers/seed";

/**
 * Attacks, attempted rather than reasoned about.
 *
 * Tenancy has its own file; this is everything else — the request that lies
 * about who it is, the value that tries to be code, the field that is not
 * supposed to be settable, and the secret that must never reach a browser.
 *
 * Nothing here is exotic. They are the things a competent person tries in the
 * first ten minutes, which is the point: they should all already fail.
 */
test.describe("security", () => {
  test("a client cannot put a row in another organisation by asking nicely", async ({
    tenant, newTenant,
  }) => {
    const victim = await newTenant({ label: "Victim" });

    // Mass assignment: org_id is in the table, so try naming it.
    const res = await tenant.page.request.post("/api/parties", {
      data: { name: "Planted", payment_terms_days: 30, org_id: victim.orgId },
    });

    // Either the field is rejected or it is ignored — never honoured.
    if (res.ok()) {
      const { data: theirs } = await victim.db.from("parties").select("id");
      expect(theirs, "a party was planted in another organisation").toEqual([]);
      const { data: mine } = await tenant.db.from("parties").select("org_id");
      expect(mine![0].org_id).toBe(tenant.orgId);
    } else {
      expect(res.status()).toBeGreaterThanOrEqual(400);
    }
  });

  test("a client cannot name its own document total or tax", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 100_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });

    const res = await tenant.page.request.post("/api/documents", {
      data: {
        doc_kind: "invoice", counterparty_id: partyId,
        doc_date: "2026-06-30", activity_ids: [activityId],
        // All three are computed server-side and must be ignored.
        total_minor: 1, taxable_value_minor: 1,
        taxes: [{ component_code: "VAT", component_label: "VAT 0%", rate_pct: 0, amount_minor: 0 }],
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const { data: body } = await res.json();

    expect(body.total_minor).toBe(118_000_00);
    const { data: doc } = await tenant.db
      .from("documents").select("total_minor, taxable_value_minor").eq("id", body.document_id).single();
    expect(doc).toMatchObject({ total_minor: 118_000_00, taxable_value_minor: 100_000_00 });
  });

  test("SQL in a value stays a value", async ({ tenant }) => {
    const nasty = "Robert'); drop table public.activities; --";

    const partyRes = await tenant.page.request.post("/api/parties", {
      data: { name: nasty, payment_terms_days: 30 },
    });
    expect(partyRes.ok()).toBeTruthy();

    const typeId = await activityTypeId(tenant, "trip");
    const { data: party } = await tenant.db.from("parties").select("id, name").single();
    expect(party!.name).toBe(nasty);

    // And through `details`, which is the free-shaped one and so the obvious
    // place to try. It reaches a jsonb column and a trigger that reads it.
    const res = await tenant.page.request.post("/api/activities", {
      data: {
        activity_type_id: typeId, party_id: party!.id, occurred_on: "2026-06-10",
        details: { origin: nasty, destination: "'; delete from public.parties; --" },
        amount_minor: 1000,
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    // Everything still standing, values stored verbatim.
    const { data: acts } = await tenant.db.from("activities").select("details");
    expect((acts![0].details as Record<string, string>).origin).toBe(nasty);
    const { data: parties } = await tenant.db.from("parties").select("id");
    expect(parties).toHaveLength(1);
  });

  test("a script in a party name renders as text, not as script", async ({ tenant }) => {
    const xss = '<script>window.__pwned = true</script>';
    await tenant.page.request.post("/api/parties", {
      data: { name: `Acme ${xss}`, payment_terms_days: 30 },
    });

    await tenant.page.goto("/parties");
    await expect(tenant.page.getByText(`Acme ${xss}`)).toBeVisible();
    // React escapes by default; this asserts nobody has reached for
    // dangerouslySetInnerHTML on the way past.
    expect(await tenant.page.evaluate(() => (window as { __pwned?: boolean }).__pwned)).toBeUndefined();
  });

  test("the service role key never reaches the browser", async ({ tenant }) => {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    expect(serviceKey.length).toBeGreaterThan(20);

    for (const path of ["/", "/login", "/dashboard", "/documents", "/settings"]) {
      await tenant.page.goto(path);
      const html = await tenant.page.content();
      expect(html, `${path} leaks the service role key`).not.toContain(serviceKey);
      expect(html, `${path} leaks the db password`).not.toContain("postgresql://");
    }
  });

  test("a forged session is refused", async ({ browser, baseURL }) => {
    const context = await browser.newContext();
    try {
      // A syntactically plausible cookie with a made-up token.
      const forged = Buffer.from(
        JSON.stringify({
          access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhdHRhY2tlciIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.not-a-real-signature",
          refresh_token: "nope", expires_at: 9999999999, token_type: "bearer",
          user: { id: "00000000-0000-4000-8000-000000000000" },
        }),
        "utf8",
      ).toString("base64");

      await context.addCookies([{
        name: "sb-127-auth-token", value: `base64-${forged}`,
        domain: new URL(baseURL!).hostname, path: "/",
        httpOnly: false, secure: false, sameSite: "Lax",
      }]);

      const res = await context.request.get("/api/documents");
      expect(res.status(), "an unsigned token must not authenticate").toBe(401);
    } finally {
      await context.close();
    }
  });

  test("a huge payload is refused rather than absorbed", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");

    const res = await tenant.page.request.post("/api/activities", {
      data: {
        activity_type_id: typeId, party_id: partyId, occurred_on: "2026-06-10",
        details: { origin: "A", destination: "x".repeat(200_000) },
        amount_minor: 1000,
      },
    });
    // Bounded by validation rather than by whatever the database will take.
    expect(res.ok(), "a 200KB field value should not be stored").toBeFalsy();
  });

  test("security headers are set on every response", async ({ tenant }) => {
    const res = await tenant.page.goto("/dashboard");
    const headers = res!.headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
  });

  test("a PDF is private and never cached by a shared proxy", async ({ tenant }) => {
    const partyId = await addParty(tenant, { name: "Konkan Ceramics", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");
    const activityId = await recordActivity(tenant, {
      typeId, partyId, amountMinor: 10_000_00, occurredOn: "2026-06-10", details: trip("A", "B"),
    });
    const inv = await issueInvoice(tenant, {
      partyId, activityIds: [activityId], docDate: "2026-06-30",
    });

    const res = await tenant.page.request.get(`/api/documents/${inv.documentId}/pdf`);
    const cache = res.headers()["cache-control"] ?? "";
    expect(cache).toContain("private");
    expect(cache).not.toContain("public");
  });

  test("an activity cannot be recorded against another organisation's type", async ({
    tenant, newTenant,
  }) => {
    const other = await newTenant({ label: "Someone Else" });
    const theirType = await activityTypeId(other, "trip");
    const myParty = await addParty(tenant, { name: "My Customer", regionCode: "KA" });

    const res = await tenant.page.request.post("/api/activities", {
      data: {
        activity_type_id: theirType, party_id: myParty,
        occurred_on: "2026-06-10", details: trip("A", "B"), amount_minor: 1000,
      },
    });
    expect(res.status(), "another org's type is not found, not forbidden").toBe(404);
  });

  test("a system template cannot be used directly, only copied", async ({ tenant }) => {
    // The composite foreign key makes this structurally impossible: templates
    // have org_id NULL and activities have org_id NOT NULL, so no row can
    // reference one. Worth asserting, because it is enforced by schema shape
    // rather than by anything a reader would notice.
    const { data: template } = await tenant.db
      .from("activity_types").select("id").is("org_id", null).eq("key", "trip").single();
    const partyId = await addParty(tenant, { name: "My Customer", regionCode: "KA" });

    const { error } = await tenant.db.rpc("record_activity", {
      p_activity_type_id: template!.id, p_party_id: partyId,
      p_occurred_on: "2026-06-10", p_amount_minor: 1000,
      p_details: trip("A", "B") as never, p_status: "completed",
    });
    expect(error).not.toBeNull();
  });
});
