"use client";

import { ReceiptsPanel, type PaymentRow } from "./ReceiptsPanel";
import { VendorPaymentForm, type VendorService } from "./VendorPaymentForm";
import type { OpenDocument } from "./ReceiptForm";
import type { PartyRole } from "@/lib/parties/roles";

/**
 * The "Vendor payments" section of the Payments page — history plus a form,
 * same shell every other payments list uses (ReceiptsPanel), but with
 * VendorPaymentForm's service-linking and "new charge" flow in place of the
 * plain ReceiptForm. Split out from the page itself only because a server
 * component can't hand a render function across to a client component —
 * every prop here is plain data, and the closure is built on this side of
 * that boundary.
 */
export function VendorPaymentsPanel({
  parties,
  servicesByVendor,
  openBillsByParty,
  rows,
  unappliedById,
  locale,
  today,
  defaultCurrency,
}: {
  parties: { id: string; name: string; role?: PartyRole; kind?: "client" | "vendor" | null }[];
  servicesByVendor: Record<string, VendorService[]>;
  openBillsByParty: Record<string, OpenDocument[]>;
  rows: PaymentRow[];
  unappliedById: Map<string, number>;
  locale: string;
  today: string;
  defaultCurrency: string;
}) {
  return (
    <ReceiptsPanel
      heading="h2"
      title="Vendor payments"
      description="Money paid out to vendors, with every payment traceable to the bill — and the service — it settled."
      addLabel="Record payment"
      parties={parties}
      openByParty={openBillsByParty}
      rows={rows}
      unappliedById={unappliedById}
      locale={locale}
      today={today}
      direction="out"
      defaultCurrency={defaultCurrency}
      partyColumn="To"
      emptyLabel="Nothing paid out yet."
      pdfHrefPrefix="/api/logistics/payments"
      formOverride={(onDone) => (
        <VendorPaymentForm
          parties={parties}
          servicesByVendor={servicesByVendor}
          openBillsByParty={openBillsByParty}
          locale={locale}
          today={today}
          defaultCurrency={defaultCurrency}
          onDone={onDone}
        />
      )}
    />
  );
}
