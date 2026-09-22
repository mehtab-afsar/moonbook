"use client";

import { useState } from "react";
import { IssueForm, type BillableActivity, type PartyOption } from "./IssueForm";
import { VendorPaymentForm, type VendorService } from "./VendorPaymentForm";
import type { OpenDocument } from "./ReceiptForm";

/**
 * Invoice / Vendor payment, one toggle — same tab pattern as the Parties
 * list's Clients/Vendors filter. Two different things used to live on two
 * different pages (Issue an invoice, and a separate Record a bill that only
 * created the bill, paid later from a third page); this is the same two
 * actions, reachable without leaving Documents.
 */
export function DocumentsNewTabs({
  parties,
  activitiesByParty,
  servicesByVendor,
  openBillsByParty,
  locale,
  today,
  defaultCurrency,
}: {
  parties: PartyOption[];
  activitiesByParty: Record<string, BillableActivity[]>;
  servicesByVendor: Record<string, VendorService[]>;
  openBillsByParty: Record<string, OpenDocument[]>;
  locale: string;
  today: string;
  defaultCurrency: string;
}) {
  const [tab, setTab] = useState<"invoice" | "vendor">("invoice");

  return (
    <div className="space-y-6">
      <div className="flex gap-1 rounded-md border border-line bg-white p-0.5" style={{ width: "fit-content" }}>
        <button
          type="button"
          onClick={() => setTab("invoice")}
          className={`rounded px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
            tab === "invoice" ? "bg-ink text-white" : "text-ink-2 hover:bg-paper"
          }`}
        >
          Invoice
        </button>
        <button
          type="button"
          onClick={() => setTab("vendor")}
          className={`rounded px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
            tab === "vendor" ? "bg-ink text-white" : "text-ink-2 hover:bg-paper"
          }`}
        >
          Vendor payment
        </button>
      </div>

      {tab === "invoice" ? (
        <IssueForm parties={parties} activitiesByParty={activitiesByParty} locale={locale} today={today} docKind="invoice" />
      ) : (
        <VendorPaymentForm
          parties={parties}
          servicesByVendor={servicesByVendor}
          openBillsByParty={openBillsByParty}
          locale={locale}
          today={today}
          defaultCurrency={defaultCurrency}
        />
      )}
    </div>
  );
}
