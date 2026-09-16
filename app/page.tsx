import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-white text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between px-7">
          <span className="font-semibold">Moonbook</span>
          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-md px-3 py-2 text-[15px] text-ink-2 hover:text-ink">
              Sign in
            </Link>
            <Link
              href="/start"
              className="rounded-[8px] bg-ink px-4 py-[9px] text-[14px] font-medium text-white hover:bg-ink-2"
            >
              Start free
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto flex min-h-[calc(100dvh-64px)] max-w-[1120px] flex-col justify-center px-7">
        <h1 className="max-w-[18ch] text-[clamp(38px,5vw,62px)] leading-[1.04] font-medium tracking-[-0.03em] text-balance">
          Billing that fits your business, not the other way round.
        </h1>
        <p className="mt-6 max-w-[52ch] text-[19px] leading-[1.5] text-ink-2">
          Invoice the right party, collect payments, and always know what&apos;s outstanding —
          configured to your industry and your country, not rebuilt for them.
        </p>
        <div className="mt-8">
          <Link
            href="/start"
            className="rounded-[8px] bg-ink px-6 py-[15px] text-[16px] font-medium text-white hover:bg-ink-2"
          >
            Start free
          </Link>
        </div>
      </main>
    </div>
  );
}
