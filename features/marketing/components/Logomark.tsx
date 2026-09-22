/**
 * The mark: a single cloud, no background plate, no moon — just the shape,
 * so it drops cleanly onto white header/sidebar chrome. Geometry mirrors
 * app/icon.tsx's favicon (that route can't reuse this component — it renders
 * through @vercel/og's own SVG subset — so the path is duplicated there on
 * purpose; keep the two in sync).
 */
export function Logomark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M23.5 24H10.8a6.8 6.8 0 1 1 2.06-13.28A8 8 0 0 1 27.9 15.1 4.9 4.9 0 0 1 23.5 24Z"
        fill="#171a2e"
      />
    </svg>
  );
}
