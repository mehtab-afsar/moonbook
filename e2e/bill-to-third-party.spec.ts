import { test, expect } from "./fixtures";
import { addParty, activityTypeId, recordActivity, issueInvoice, trip } from "./helpers/seed";

/**
 * Billing someone other than the party the work was done for.
 *
 * The freight template's own description says it: "Bill the broker or the
 * consignee." A load is delivered to a consignee and invoiced to the broker
 * who booked it, and the two are different companies. `bill_to_party_id`
 * exists for this, `party_ready_to_bill` groups by
 * `coalesce(bill_to_party_id, party_id)` because of it, and getting it wrong
 * means invoicing the wrong company — which is not a rounding error, it is a
 * bill sent to someone who owes nothing.
 */
test.describe("billing a third party", () => {
  test("work is offered to whoever pays, not whoever received it", async ({ tenant }) => {
    const consignee = await addParty(tenant, { name: "Consignee Mills", regionCode: "KA" });
    const broker = await addParty(tenant, { name: "Broker & Co", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");

    await recordActivity(tenant, {
      typeId,
      partyId: consignee,
      billToPartyId: broker,
      amountMinor: 10_000_00,
      occurredOn: "2026-06-10",
      details: trip("Bengaluru", "Hubballi"),
    });

    await tenant.page.goto("/documents/new");

    // The broker has work ready to bill…
    await tenant.page.getByLabel("Who are you billing?").selectOption(broker);
    await expect(tenant.page.getByText("Origin: Bengaluru", { exact: false })).toBeVisible();

    // …and the consignee, who received the load, has none.
    await tenant.page.getByLabel("Who are you billing?").selectOption(consignee);
    await expect(tenant.page.getByText("Nothing completed and unbilled")).toBeVisible();
  });

  test("the invoice is addressed to the payer and owed by the payer", async ({ tenant }) => {
    const consignee = await addParty(tenant, { name: "Consignee Mills", regionCode: "KA" });
    const broker = await addParty(tenant, { name: "Broker & Co", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");

    const activityId = await recordActivity(tenant, {
      typeId, partyId: consignee, billToPartyId: broker,
      amountMinor: 10_000_00, occurredOn: "2026-06-10",
      details: trip("Bengaluru", "Hubballi"),
    });
    const invoice = await issueInvoice(tenant, {
      partyId: broker, activityIds: [activityId], docDate: "2026-06-30",
    });

    await tenant.page.goto(`/documents/${invoice.documentId}`);
    await expect(tenant.page.getByText("Broker & Co")).toBeVisible();

    // The debt sits with the broker, not the mill.
    const { data: outstanding } = await tenant.db
      .from("party_outstanding")
      .select("party_id, amount_outstanding_minor")
      .gt("amount_outstanding_minor", 0);
    expect(outstanding).toHaveLength(1);
    expect(outstanding![0].party_id).toBe(broker);
    expect(outstanding![0].amount_outstanding_minor).toBe(11_800_00);
  });

  test("the tax follows the payer's region, not the delivery address", async ({ tenant }) => {
    // The organisation is in KA. Delivered within KA, billed to a broker in
    // MH — so it is an inter-state supply and IGST applies, because tax
    // follows the place of supply for the BILL, not the lorry's destination.
    const consignee = await addParty(tenant, { name: "Consignee Mills", regionCode: "KA" });
    const broker = await addParty(tenant, { name: "Mumbai Broker", regionCode: "MH" });
    const typeId = await activityTypeId(tenant, "trip");

    const activityId = await recordActivity(tenant, {
      typeId, partyId: consignee, billToPartyId: broker,
      amountMinor: 100_000_00, occurredOn: "2026-06-10",
      details: trip("Bengaluru", "Mysuru"),
    });
    const invoice = await issueInvoice(tenant, {
      partyId: broker, activityIds: [activityId], docDate: "2026-06-30",
    });

    const { data: taxes } = await tenant.db
      .from("document_taxes").select("component_code").eq("document_id", invoice.documentId);
    expect(taxes!.map((t) => t.component_code)).toEqual(["IGST"]);
    expect(invoice.totalMinor).toBe(118_000_00);
  });

  test("the form lets a person choose who pays", async ({ tenant }) => {
    await addParty(tenant, { name: "Consignee Mills", regionCode: "KA" });
    await addParty(tenant, { name: "Broker & Co", regionCode: "KA" });

    await tenant.page.goto("/activities");
    await tenant.page.getByLabel("Party").selectOption({ label: "Consignee Mills" });

    // The party itself is not offered as its own payer — "same as party" is
    // what blank already means.
    const options = await tenant.page.getByLabel("Bill to (if different)")
      .locator("option").allTextContents();
    expect(options).toEqual(["Same as party", "Broker & Co"]);

    await tenant.page.getByLabel("Bill to (if different)").selectOption({ label: "Broker & Co" });
    await tenant.page.getByLabel("Origin").fill("Bengaluru");
    await tenant.page.getByLabel("Destination").fill("Hubballi");
    await tenant.page.getByLabel("Amount (INR)").fill("10000");
    await tenant.page.getByRole("button", { name: /Record/ }).click();

    await expect(tenant.page.getByRole("cell", { name: "Consignee Mills" })).toBeVisible();

    const { data: parties } = await tenant.db.from("parties").select("id, name");
    const broker = parties!.find((p) => p.name === "Broker & Co")!;
    const { data } = await tenant.db.from("activities").select("bill_to_party_id");
    expect(data![0].bill_to_party_id).toBe(broker.id);
  });

  test("a bill-to party from another organisation is refused", async ({ tenant, newTenant }) => {
    const other = await newTenant({ label: "Someone Else" });
    const theirParty = await addParty(other, { name: "Their Customer", regionCode: "KA" });

    const mine = await addParty(tenant, { name: "My Customer", regionCode: "KA" });
    const typeId = await activityTypeId(tenant, "trip");

    const { error } = await tenant.db.rpc("record_activity", {
      p_activity_type_id: typeId,
      p_party_id: mine,
      p_bill_to_party_id: theirParty,
      p_occurred_on: "2026-06-10",
      p_amount_minor: 10_000_00,
      p_details: trip("A", "B") as never,
      p_status: "completed",
    });
    expect(error, "a stranger's party must not be billable").not.toBeNull();
    expect(error!.message).toMatch(/bill-to party not found/i);
  });
});
