import Link from "next/link";
import {
  Truck,
  Recycle,
  Coffee,
  Package,
  ArrowRight,
  ReceiptText,
  Landmark,
  Database,
  Lock,
  ChevronDown,
} from "lucide-react";
import { SiteHeader } from "@/features/marketing/components/SiteHeader";
import { CursorGlare } from "@/features/marketing/components/CursorGlare";
import { TypingWord } from "@/features/marketing/components/TypingWord";

const INDUSTRIES = [
  {
    icon: Truck,
    iconClassName: "icon-truck",
    name: "Freight & logistics",
    detail: "Trips with an origin, a destination and a vehicle. Bill the broker or the consignee — and now track what you owe the vendor who ran it.",
  },
  {
    icon: Recycle,
    iconClassName: "icon-recycle",
    name: "Scrap & recycling",
    detail: "Buy material by weight from collectors, sell it on by grade. Bills in both directions, kept as two separate ledgers.",
  },
  {
    icon: Coffee,
    iconClassName: "icon-coffee",
    name: "Café & hospitality",
    detail: "Account customers, catering orders and supplier deliveries. Counter sales stay where they belong — in a till.",
  },
  {
    icon: Package,
    iconClassName: "icon-wholesale",
    name: "Wholesale & distribution",
    detail: "Goods sold by the case or the unit, priced per unit, billed to trade customers — each product its own line.",
  },
] as const;

const FEATURES = [
  {
    icon: ReceiptText,
    title: "One tax engine, every regime",
    detail:
      "GST, VAT, split-rate, reverse charge — computed server-side, every time. A figure is never one browser's opinion.",
  },
  {
    icon: Landmark,
    title: "Documents that freeze",
    detail:
      "Issue an invoice and it locks — numbers, wording, the document itself. Corrections go through a credit note. Never a quiet edit.",
  },
  {
    icon: Database,
    title: "A ledger, not a spreadsheet",
    detail:
      "Every payment nets against what's actually outstanding. Settled, pending, overdue — computed states, not a column someone forgot to update.",
  },
  {
    icon: Lock,
    title: "Isolated at the database",
    detail:
      "Every organisation's rows are walled off by database policy, not application code. One tenant's data can't leak into another's by a missed check.",
  },
] as const;

const FAQ = [
  {
    q: "Which industries does Moonbook support?",
    a: "Freight & logistics, scrap & recycling, café & hospitality, and wholesale & distribution ship today. If your trade isn't one of these, we set it up directly — the financial core (tax, numbering, frozen documents) never has to change for a new one.",
  },
  {
    q: "How does tax get computed?",
    a: "Server-side, from your configured regime and the customer's region — split-rate GST, VAT, reverse charge and more. Nothing about a total is computed or trusted from the browser.",
  },
  {
    q: "Can I edit an invoice after I've sent it?",
    a: "No — on purpose. A document freezes the moment it's issued. Corrections go through a credit note, so the paper trail always matches what was actually sent.",
  },
  {
    q: "Is my organisation's data separated from other customers'?",
    a: "Yes — at the database level, via row-level security, not just an application-side check. One organisation's rows are structurally unreachable from another's session.",
  },
  {
    q: "What does it cost to get started?",
    a: "Nothing. Create an account, pick your trade, and you're recording activity within minutes. No card required.",
  },
] as const;

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-white text-ink">
      {/* Fixed to the viewport, mounted once here, so the glare keeps
          following the pointer down the whole page, not just the hero. */}
      <CursorGlare />
      <SiteHeader
        nav={
          <>
            <a href="#industries" className="text-[14px] font-medium text-ink-2 hover:text-ink">
              Industries
            </a>
            <a href="#faq" className="text-[14px] font-medium text-ink-2 hover:text-ink">
              FAQ
            </a>
            <a href="mailto:hello@moonbook.app" className="text-[14px] font-medium text-ink-2 hover:text-ink">
              Contact
            </a>
          </>
        }
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
      <section className="relative overflow-hidden bg-white">
        {/* Everything below fades in over the first ~80px instead of being hard-
            clipped by the section's own edge — a blurred glow's soft falloff
            otherwise gets cut into a visible flat edge right behind the
            floating navbar. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,transparent,black_80px)]"
        >
          {/* A thin diagonal flare streak for depth against the flat white page. */}
          <div className="absolute top-0 left-1/2 h-[900px] w-[2px] -translate-x-1/2 rotate-[18deg] bg-gradient-to-b from-transparent via-ink/[0.10] to-transparent blur-2xl" />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 [background-image:linear-gradient(to_right,#f7f8fb_1px,transparent_1px),linear-gradient(to_bottom,#f7f8fb_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]"
        />
        <div className="relative mx-auto flex min-h-[calc(100dvh-72px)] max-w-[980px] flex-col items-center justify-center px-7 py-20 text-center">
          <h1 className="animate-fade-up max-w-[24ch] text-[clamp(36px,5.4vw,58px)] leading-[1.08] font-medium tracking-[-0.03em] text-balance">
            <TypingWord /> that fits your business, not the other way round.
          </h1>
          <p className="animate-fade-up [animation-delay:160ms] mt-6 max-w-[52ch] text-[19px] leading-[1.5] text-ink-2">
            Invoice the right party. Collect what&apos;s owed. Always know what&apos;s outstanding —
            configured to your industry and your country, never rebuilt for them.
          </p>
          <div className="animate-fade-up [animation-delay:240ms] mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/start"
              className="group inline-flex items-center gap-2 rounded-[8px] bg-ink px-6 py-[15px] text-[16px] font-medium text-white shadow-[0_1px_2px_rgba(23,26,46,0.08)] transition-all duration-150 hover:-translate-y-px hover:bg-ink-2 hover:shadow-[0_8px_20px_rgba(23,26,46,0.16)]"
            >
              Start free
              <ArrowRight className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={2} />
            </Link>
            <a href="#industries" className="text-[15px] font-medium text-ink-2 hover:text-ink">
              See how it works
            </a>
          </div>
          <p className="animate-fade-up [animation-delay:300ms] mt-5 text-[13px] text-ink-3">No card required — live in minutes.</p>
        </div>
      </section>

      {/* ── Industries ────────────────────────────────────────────────────── */}
      <section id="industries" className="bg-white">
        <div className="mx-auto max-w-[1120px] px-7 py-20">
          <h2 className="max-w-[32ch] text-[30px] leading-[1.15] font-medium tracking-[-0.02em] text-ink">
            Built for how you bill. Not how software wishes you did.
          </h2>
          <p className="mt-3 max-w-[56ch] text-[15.5px] leading-[1.55] text-ink-2">
            Same tax engine. Same numbering. Same frozen documents. The only thing that changes
            between industries is what gets recorded.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {INDUSTRIES.map(({ icon: Icon, iconClassName, name, detail }, i) => (
              <div
                key={name}
                className="group animate-fade-up rounded-[10px] border border-line bg-white p-6 transition-all duration-150 hover:-translate-y-0.5 hover:border-ink-3/40 hover:shadow-[0_16px_32px_-20px_rgba(23,26,46,0.2)]"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <span className="flex size-9 items-center justify-center overflow-hidden rounded-md bg-brand-tint text-brand transition-all duration-300 ease-out group-hover:bg-ink group-hover:text-white">
                  <Icon className={`size-[18px] ${iconClassName}`} strokeWidth={1.75} />
                </span>
                <h3 className="mt-4 text-[16px] font-semibold text-ink">{name}</h3>
                <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ink-2">{detail}</p>
              </div>
            ))}
          </div>

          <p className="mt-6 text-[13.5px] text-ink-3">
            Not your trade? We&apos;ll set it up directly — the financial core never has to change
            for it.
          </p>
        </div>
      </section>

      {/* ── Feature depth ────────────────────────────────────────────────── */}
      <section className="bg-white">
        <div className="mx-auto max-w-[1120px] px-7 py-20">
          <h2 className="max-w-[30ch] text-[30px] leading-[1.15] font-medium tracking-[-0.02em] text-ink">
            The financial core. The same under every trade.
          </h2>
          <p className="mt-3 max-w-[56ch] text-[15.5px] leading-[1.55] text-ink-2">
            The part that never changes between industries is the part that has to be right —
            every time, not most of the time.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, detail }) => (
              <div
                key={title}
                className="rounded-[10px] border border-line bg-white p-6 transition-all duration-150 hover:-translate-y-0.5 hover:border-ink-3/40 hover:shadow-[0_16px_32px_-20px_rgba(23,26,46,0.2)]"
              >
                <span className="flex size-9 items-center justify-center rounded-md bg-ink text-white">
                  <Icon className="size-[18px]" strokeWidth={1.75} />
                </span>
                <h3 className="mt-4 text-[16px] font-semibold text-ink">{title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ink-2">{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────────── */}
      <section id="faq">
        <div className="mx-auto max-w-[760px] px-7 py-20">
          <h2 className="text-[30px] leading-[1.15] font-medium tracking-[-0.02em] text-ink">
            Questions, answered.
          </h2>

          <div className="mt-8 divide-y divide-line-soft border-t border-line-soft">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15.5px] font-medium text-ink">
                  {q}
                  <ChevronDown
                    className="size-4 shrink-0 text-ink-3 transition-transform duration-150 group-open:rotate-180"
                    strokeWidth={2}
                  />
                </summary>
                <p className="mt-3 max-w-[64ch] text-[14.5px] leading-[1.6] text-ink-2">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────────────── */}
      <section>
        <div className="mx-auto max-w-[1120px] px-7 py-16">
          <div className="relative overflow-hidden rounded-[18px] bg-ink px-8 py-14 sm:px-14">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-24 -right-24 size-[320px] rounded-full bg-brand/25 blur-[100px]"
            />
            <div className="relative flex flex-wrap items-center justify-between gap-6">
              <div>
                <h2 className="max-w-[28ch] text-[26px] leading-[1.2] font-medium tracking-[-0.02em] text-white">
                  Set up your business. Send your first invoice today.
                </h2>
                <p className="mt-2 text-[13.5px] text-white/60">No card required — live in minutes.</p>
              </div>
              <Link
                href="/start"
                className="group inline-flex shrink-0 items-center gap-2 rounded-[8px] bg-white px-6 py-[15px] text-[16px] font-medium text-ink transition-all duration-150 hover:-translate-y-px hover:shadow-[0_8px_20px_rgba(0,0,0,0.25)]"
              >
                Start free
                <ArrowRight className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={2} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="mx-auto max-w-[1120px] px-7 py-12">
          <div className="flex flex-wrap items-start justify-between gap-10">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="font-semibold text-ink">Moonbook</span>
            </Link>
            <div className="flex flex-wrap gap-x-14 gap-y-6">
              <div className="flex flex-col gap-2.5">
                <span className="text-[12px] font-medium tracking-[0.04em] text-ink-3 uppercase">Product</span>
                <a href="#industries" className="text-[13.5px] text-ink-2 hover:text-ink">Industries</a>
                <a href="#faq" className="text-[13.5px] text-ink-2 hover:text-ink">FAQ</a>
                <a href="mailto:hello@moonbook.app" className="text-[13.5px] text-ink-2 hover:text-ink">Contact</a>
              </div>
              <div className="flex flex-col gap-2.5">
                <span className="text-[12px] font-medium tracking-[0.04em] text-ink-3 uppercase">Account</span>
                <Link href="/login" className="text-[13.5px] text-ink-2 hover:text-ink">Sign in</Link>
                <Link href="/start" className="text-[13.5px] text-ink-2 hover:text-ink">Start free</Link>
              </div>
            </div>
          </div>
          <div className="mt-10 border-t border-line-soft pt-6 text-[13px] text-ink-3">
            © {new Date().getFullYear()} Moonbook
          </div>
        </div>
      </footer>
    </div>
  );
}
