import Link from "next/link";
import { Truck, Recycle, Coffee, Package, Sparkles, ArrowRight, ShieldCheck, ReceiptText, Landmark } from "lucide-react";
import { SiteHeader } from "@/features/marketing/components/SiteHeader";

const INDUSTRIES = [
  {
    icon: Truck,
    name: "Freight & logistics",
    detail: "Trips with an origin, a destination and a vehicle. Bill the broker or the consignee — and now track what you owe the vendor who ran it.",
  },
  {
    icon: Recycle,
    name: "Scrap & recycling",
    detail: "Buy material by weight from collectors, sell it on by grade. Bills in both directions, kept as two separate ledgers.",
  },
  {
    icon: Coffee,
    name: "Café & hospitality",
    detail: "Account customers, catering orders and supplier deliveries. Counter sales stay where they belong — in a till.",
  },
  {
    icon: Package,
    name: "Wholesale & distribution",
    detail: "Goods sold by the case or the unit, priced per unit, billed to trade customers — each product its own line.",
  },
] as const;

const STEPS = [
  {
    n: "01",
    title: "Pick your trade",
    detail: "Country, currency, tax regime and financial year follow from one question. Your industry's fields come with it.",
  },
  {
    n: "02",
    title: "Record what you did",
    detail: "The form has no fields of its own — it renders whatever your business records, priced the way you price it.",
  },
  {
    n: "03",
    title: "Bill it, take the money",
    detail: "Tax computed from your regime and the customer's region. Once issued, a document is frozen — nothing rewrites it later.",
  },
] as const;

const TRUST = [
  { icon: ShieldCheck, label: "Every organisation's data is isolated at the database level, not just in the app" },
  { icon: ReceiptText, label: "Tax is computed server-side — a browser can never name its own total" },
  { icon: Landmark, label: "A document is frozen the moment it's issued, so later changes can't reword it" },
] as const;

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-white text-ink">
      <SiteHeader
        actions={
          <>
            <Link href="/login" className="rounded-md px-3 py-2 text-[15px] text-ink-2 hover:text-ink">
              Sign in
            </Link>
            <Link
              href="/start"
              className="rounded-[8px] bg-ink px-4 py-[9px] text-[14px] font-medium text-white hover:bg-ink-2"
            >
              Start free
            </Link>
          </>
        }
      />

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="mx-auto flex min-h-[calc(100dvh-64px)] max-w-[1120px] flex-col justify-center px-7 py-20">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-[12.5px] font-medium text-ink-2">
          <Sparkles className="size-3.5 text-brand" strokeWidth={1.75} />
          One system, configured per trade
        </span>
        <h1 className="mt-5 max-w-[18ch] text-[clamp(38px,5vw,62px)] leading-[1.04] font-medium tracking-[-0.03em] text-balance">
          Billing that fits your business, not the other way round.
        </h1>
        <p className="mt-6 max-w-[52ch] text-[19px] leading-[1.5] text-ink-2">
          Invoice the right party, collect payments, and always know what&apos;s outstanding —
          configured to your industry and your country, not rebuilt for them.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href="/start"
            className="group inline-flex items-center gap-2 rounded-[8px] bg-ink px-6 py-[15px] text-[16px] font-medium text-white hover:bg-ink-2"
          >
            Start free
            <ArrowRight className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={2} />
          </Link>
          <a href="#industries" className="text-[15px] font-medium text-ink-2 hover:text-ink">
            See how it works
          </a>
        </div>
      </section>

      {/* ── Industries ────────────────────────────────────────────────────── */}
      <section id="industries" className="border-t border-line bg-paper">
        <div className="mx-auto max-w-[1120px] px-7 py-20">
          <h2 className="max-w-[32ch] text-[30px] leading-[1.15] font-medium tracking-[-0.02em] text-ink">
            Built for how you actually bill.
          </h2>
          <p className="mt-3 max-w-[56ch] text-[15.5px] leading-[1.55] text-ink-2">
            Every business here runs on the same core — the same tax engine, the same numbering,
            the same frozen documents. What differs is only what gets recorded.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {INDUSTRIES.map(({ icon: Icon, name, detail }) => (
              <div key={name} className="rounded-[10px] border border-line bg-white p-6">
                <span className="flex size-9 items-center justify-center rounded-md bg-brand-tint text-brand">
                  <Icon className="size-[18px]" strokeWidth={1.75} />
                </span>
                <h3 className="mt-4 text-[16px] font-semibold text-ink">{name}</h3>
                <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ink-2">{detail}</p>
              </div>
            ))}
          </div>

          <p className="mt-6 text-[13.5px] text-ink-3">
            Not your trade? We set new ones up directly — the financial core never has to change
            for it.
          </p>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-[1120px] px-7 py-20">
          <h2 className="text-[30px] leading-[1.15] font-medium tracking-[-0.02em] text-ink">
            From set up to paid, in three steps.
          </h2>

          <div className="mt-10 grid gap-8 sm:grid-cols-3">
            {STEPS.map(({ n, title, detail }) => (
              <div key={n}>
                <span className="font-mono text-[13px] font-medium text-brand">{n}</span>
                <h3 className="mt-2 text-[16px] font-semibold text-ink">{title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ink-2">{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trust strip ───────────────────────────────────────────────────── */}
      <section className="border-t border-line bg-paper">
        <div className="mx-auto grid max-w-[1120px] gap-6 px-7 py-14 sm:grid-cols-3">
          {TRUST.map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-start gap-3">
              <Icon className="mt-0.5 size-[18px] shrink-0 text-brand" strokeWidth={1.75} />
              <p className="text-[13.5px] leading-[1.55] text-ink-2">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────────────── */}
      <section className="border-t border-line">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-6 px-7 py-16">
          <h2 className="max-w-[28ch] text-[24px] leading-[1.2] font-medium tracking-[-0.02em] text-ink">
            Set up your business and issue your first invoice today.
          </h2>
          <Link
            href="/start"
            className="inline-flex shrink-0 items-center gap-2 rounded-[8px] bg-ink px-6 py-[15px] text-[16px] font-medium text-white hover:bg-ink-2"
          >
            Start free
            <ArrowRight className="size-4" strokeWidth={2} />
          </Link>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-4 px-7 py-8 text-[13px] text-ink-3">
          <span>© {new Date().getFullYear()} Moonbook</span>
          <div className="flex items-center gap-5">
            <Link href="/login" className="hover:text-ink-2">Sign in</Link>
            <Link href="/start" className="hover:text-ink-2">Start free</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
