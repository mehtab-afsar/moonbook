"use client";

import { useEffect, useRef } from "react";

// Fixed to the viewport rather than any one section, so `clientX`/`clientY`
// already line up with the glare's own box — no scroll offset to account
// for, and it keeps tracking the pointer no matter how far down the page
// you've scrolled. Position moves via `background-position` (animatable)
// against a static gradient image, not the gradient's own `at x y` syntax
// (a `background-image` swap is discrete and can't be eased) — that's what
// lets the CSS transition below glide it toward the pointer instead of
// snapping to it.
const SIZE = 900;
const RADIUS = SIZE / 2;

/**
 * A soft black glare that drifts after the pointer across the entire
 * landing page — mixed multiply over whatever section is currently in
 * view, so it reads as ambient light rather than a flat overlay. Skips
 * entirely on touch: there's no pointer to chase without a hover-capable
 * one.
 */
export function CursorGlare() {
  const spotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const spot = spotRef.current;
    if (!spot) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    let raf = 0;
    function handleMove(e: PointerEvent) {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        spot!.style.backgroundPosition = `${e.clientX - RADIUS}px ${e.clientY - RADIUS}px`;
      });
    }

    window.addEventListener("pointermove", handleMove);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={spotRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 mix-blend-multiply motion-reduce:hidden"
      style={{
        backgroundImage: "radial-gradient(circle, rgba(10,11,20,0.16), transparent 70%)",
        backgroundRepeat: "no-repeat",
        backgroundSize: `${SIZE}px ${SIZE}px`,
        backgroundPosition: "50% -450px",
        transition: "background-position 550ms cubic-bezier(0.22, 1, 0.36, 1)",
        willChange: "background-position",
      }}
    />
  );
}
