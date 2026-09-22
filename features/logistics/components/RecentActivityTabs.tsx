"use client";

import { useState } from "react";
import Link from "next/link";
import { Truck, FileText, Banknote, ArrowUpRight } from "lucide-react";
import { formatMoney } from "@/lib/money";

const STATUS_TONE: Record<string, string> = {
  completed: "bg-settled-tint text-settled-ink",
  invoiced: "bg-line-soft text-ink-2",
  cancelled: "bg-overdue-tint text-overdue",
  issued: "bg-line-soft text-ink-2",
};

export interface RecentServiceRow {
  id: string;
  direction: "receivable" | "payable";
  occurred_on: string;
  origin: string | null;
  destination: string | null;
  vendor_ref: string | null;
  amount_minor: number;
  currency: string;
  status: string;
  party_name: string | null;
}

export interface RecentInvoiceRow {
  id: string;
  doc_no: string | null;
  doc_kind: string;
  doc_date: string;
  total_minor: number;
  currency: string;
  status: string;
  party_name: string | null;
}

export interface RecentReceiptRow {
  id: string;
  paid_on: string;
  method: string;
  amount_minor: number;
  currency: string;
  party_name: string | null;
}

const METHOD_LABEL: Record<string, string> = {
  bank: "Bank transfer", cash: "Cash", cheque: "Cheque", card: "Card", online: "Online",
};

const TABS = [
  { key: "services", label: "Services", icon: Truck, viewAllHref: "/logistics/activities", viewAllLabel: "Full log" },
  { key: "invoices", label: "Invoices", icon: FileText, viewAllHref: "/logistics/documents", viewAllLabel: "All invoices" },
  { key: "receipts", label: "Receipts", icon: Banknote, viewAllHref: "/logistics/payments", viewAllLabel: "All receipts" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function RecentActivityTabs({
  services,
  invoices,
  receipts,
  locale,
}: {
  services: RecentServiceRow[];
  invoices: RecentInvoiceRow[];
  receipts: RecentReceiptRow[];
  locale: string;
}) {
  const [tab, setTab] = useState<TabKey>("services");
  const active = TABS.find((t) => t.key === tab)!;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-md border border-line bg-white p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
                tab === t.key ? "bg-ink text-white" : "text-ink-2 hover:bg-paper"
              }`}
            >
              <t.icon className="size-3.5" strokeWidth={1.75} />
              {t.label}
            </button>
          ))}
        </div>
        <Link
          href={active.viewAllHref}
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline"
        >
          {active.viewAllLabel} <ArrowUpRight className="size-3.5" strokeWidth={2} />
        </Link>
      </div>

      <div className="mt-3 overflow-hidden rounded-[10px] border border-line bg-white">
        {tab === "services" && <ServicesList rows={services} locale={locale} />}
        {tab === "invoices" && <InvoicesList rows={invoices} locale={locale} />}
        {tab === "receipts" && <ReceiptsList rows={receipts} locale={locale} />}
      </div>
    </section>
  );
}

function Empty({ icon: Icon, label }: { icon: typeof Truck; label: string }) {
  return (
    <p className="flex flex-col items-center gap-2 p-10 text-center text-[13.5px] text-ink-3">
      <Icon className="size-5" strokeWidth={1.5} />
      {label}
    </p>
  );
}

function ServicesList({ rows, locale }: { rows: RecentServiceRow[]; locale: string }) {
  if (rows.length === 0) return <Empty icon={Truck} label="Nothing logged yet. Once you record a service, it shows up here." />;
  return (
    <ul className="divide-y divide-line-soft">
      {rows.map((a) => (
        <li key={a.id} className="flex items-center gap-3 px-5 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand">
            <Truck className="size-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium text-ink">
              {a.direction === "receivable"
                ? `${a.origin ?? "—"} → ${a.destination ?? "—"}`
                : `Vendor charge${a.vendor_ref ? ` · ${a.vendor_ref}` : ""}`}
            </p>
            <p className="mt-0.5 truncate text-[12px] text-ink-3">{a.party_name ?? "—"} · {a.occurred_on}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[a.status] ?? ""}`}>
            {a.status}
          </span>
          <span className="w-24 shrink-0 text-right font-mono text-[13.5px] text-ink">
            {formatMoney(a.amount_minor, a.currency, locale)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function InvoicesList({ rows, locale }: { rows: RecentInvoiceRow[]; locale: string }) {
  if (rows.length === 0) return <Empty icon={FileText} label="Nothing issued yet. Once you issue an invoice, it shows up here." />;
  return (
    <ul className="divide-y divide-line-soft">
      {rows.map((d) => (
        <li key={d.id}>
          <Link href={`/logistics/documents/${d.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors duration-150 hover:bg-paper">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand">
              <FileText className="size-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium text-ink">{d.doc_no ?? "—"}</p>
              <p className="mt-0.5 truncate text-[12px] text-ink-3">{d.party_name ?? "—"} · {d.doc_date}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[d.status] ?? ""}`}>
              {d.doc_kind === "bill" ? "Bill" : "Invoice"}
            </span>
            <span className="w-24 shrink-0 text-right font-mono text-[13.5px] text-ink">
              {formatMoney(d.total_minor, d.currency, locale)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ReceiptsList({ rows, locale }: { rows: RecentReceiptRow[]; locale: string }) {
  if (rows.length === 0) return <Empty icon={Banknote} label="Nothing received yet. Once you record a receipt, it shows up here." />;
  return (
    <ul className="divide-y divide-line-soft">
      {rows.map((p) => (
        <li key={p.id} className="flex items-center gap-3 px-5 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-settled-tint text-settled-ink">
            <Banknote className="size-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium text-ink">{p.party_name ?? "—"}</p>
            <p className="mt-0.5 truncate text-[12px] text-ink-3">{METHOD_LABEL[p.method] ?? p.method} · {p.paid_on}</p>
          </div>
          <span className="w-24 shrink-0 text-right font-mono text-[13.5px] text-settled-ink">
            {formatMoney(p.amount_minor, p.currency, locale)}
          </span>
        </li>
      ))}
    </ul>
  );
}
