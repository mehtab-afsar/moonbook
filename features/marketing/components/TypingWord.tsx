"use client";

import { useEffect, useState } from "react";

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

export function TypingWord() {
  const [index, setIndex] = useState(0);
  const [length, setLength] = useState(0);
  const [phase, setPhase] = useState<Phase>("typing");
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

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
