"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

// Billing, in the words businesses actually use for it — English and the
// Hindi business-slang jargon ("vasooli" for chasing a payment, "hisaab" for
// the reckoning of who owes what) sit side by side on purpose, the way this
// headline's own audience talks about it.
const WORDS = ["Billing", "Payment", "Vasooli", "Hisaab"] as const;

const TYPE_MS = 85;
const DELETE_MS = 45;
const HOLD_MS = 1400;
const GAP_MS = 250;

type Phase = "typing" | "deleting";

// Subscribed via useSyncExternalStore rather than read into state inside an
// effect: that's the React-blessed way to mirror an external (browser) API,
// it reacts live if the OS-level preference changes, and — the reason it's
// here at all — a plain useEffect that calls setState on mount is exactly
// the "derived state" anti-pattern react-hooks/set-state-in-effect flags.
const QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(callback: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}
function getReducedMotion() {
  return window.matchMedia(QUERY).matches;
}
function getReducedMotionServer() {
  return false;
}

export function TypingWord() {
  const [index, setIndex] = useState(0);
  const [length, setLength] = useState(0);
  const [phase, setPhase] = useState<Phase>("typing");
  const reduced = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, getReducedMotionServer);

  useEffect(() => {
    if (reduced) return;
    const word = WORDS[index];
    let timeout: ReturnType<typeof setTimeout>;

    if (phase === "typing") {
      if (length < word.length) {
        timeout = setTimeout(() => setLength((l) => l + 1), TYPE_MS);
      } else {
        timeout = setTimeout(() => setPhase("deleting"), HOLD_MS);
      }
    } else {
      if (length > 0) {
        timeout = setTimeout(() => setLength((l) => l - 1), DELETE_MS);
      } else {
        timeout = setTimeout(() => {
          setIndex((i) => (i + 1) % WORDS.length);
          setPhase("typing");
        }, GAP_MS);
      }
    }

    return () => clearTimeout(timeout);
  }, [phase, length, index, reduced]);

  const word = WORDS[index];
  const display = reduced ? WORDS[0] : word.slice(0, length);

  return (
    <span className="relative inline-block text-brand">
      <span aria-hidden>{display}</span>
      <span className="sr-only">{WORDS[0]}</span>
    </span>
  );
}
