"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The one shared entry point onto every authenticated screen: a magic-link
 * email, no password. /login and /start's own first step both render this —
 * signing in and starting a new company are the same request; what happens
 * after is decided by app/auth/callback/route.ts once the link is clicked.
 */
export function EmailSignIn({
  next,
  heading,
  reason,
}: {
  next: string;
  heading: string;
  reason: string;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError("");

    const supabase = createClient();
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (sendError) {
      setStatus("error");
      setError("Could not send that link. Check the address and try again.");
      return;
    }
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <div>
        <h1 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.01em] text-ink">
          Check your email.
        </h1>
        <p className="mt-2.5 max-w-[46ch] text-[14px] leading-[1.55] text-ink-2">
          We sent a sign-in link to <span className="font-medium text-ink">{email}</span>. Open it
          on this device to continue.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <h1 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.01em] text-ink">
        {heading}
      </h1>
      <p className="mt-2.5 max-w-[52ch] text-[14px] leading-[1.55] text-ink-2">{reason}</p>

      <div className="mt-8">
        <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-ink">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full rounded-md border border-line bg-white px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-3 focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-brand"
        />
        {status === "error" && <p className="mt-1.5 text-[12.5px] text-alert">{error}</p>}
      </div>

      <button
        type="submit"
        disabled={status === "sending"}
        className="mt-6 rounded-md bg-brand px-5 py-3 text-[14px] font-medium text-white transition-colors duration-150 hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:bg-ink-3"
      >
        {status === "sending" ? "Sending…" : "Send me a sign-in link"}
      </button>

      <p className="mt-4 text-[12.5px] leading-[1.5] text-ink-3">
        No password to remember. The link works once and signs you straight in.
      </p>
    </form>
  );
}
