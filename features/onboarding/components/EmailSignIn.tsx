"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { inputClass, buttonPrimaryClass } from "@/lib/ui/styles";
import { StepBadge } from "./StepBadge";

/**
 * The one shared entry point onto every authenticated screen: email +
 * password. /login and /start's own first step both render this — signing
 * in and creating an account are the same form, distinguished by `mode`.
 */
export function EmailSignIn({
  next,
  heading,
  reason,
  step,
  mode = "signin",
  defaultEmail,
}: {
  next: string;
  heading: string;
  reason: string;
  /** Only set from /start, where this is the first of three steps. */
  step?: { current: number; total: number };
  /** "signup" calls auth.signUp, "signin" calls auth.signInWithPassword. */
  mode?: "signup" | "signin";
  /** Pre-filled from a `?email=` link — e.g. a future "you're invited" email. Still editable. */
  defaultEmail?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError("");

    const supabase = createClient();

    if (mode === "signup") {
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) {
        setStatus("error");
        setError(
          /registered|exists/i.test(signUpError.message)
            ? "An account already exists for that email — sign in instead."
            : signUpError.message,
        );
        return;
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setStatus("error");
        setError(
          /confirm/i.test(signInError.message)
            ? "Confirm your email first — check your inbox for the link we sent."
            : "Wrong email or password.",
        );
        return;
      }
    }

    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      {step && <StepBadge current={step.current} total={step.total} />}
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
          className={inputClass}
        />
      </div>

      <div className="mt-4">
        <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-ink">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={mode === "signup" ? 8 : undefined}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
          className={inputClass}
        />
        {status === "error" && <p className="mt-1.5 text-[12.5px] text-alert">{error}</p>}
      </div>

      <button type="submit" disabled={status === "sending"} className={`mt-6 ${buttonPrimaryClass}`}>
        {status === "sending"
          ? mode === "signup"
            ? "Creating account…"
            : "Signing in…"
          : mode === "signup"
            ? "Create account"
            : "Sign in"}
      </button>
    </form>
  );
}
