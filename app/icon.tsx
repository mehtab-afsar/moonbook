import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/**
 * Same cloud mark as Logomark.tsx, redrawn here because this route renders
 * through @vercel/og's own SVG subset (no React component reuse) rather than
 * the browser. No background plate — transparent, white fill, so it reads
 * against a dark browser tab bar.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <svg width={32} height={32} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M23.5 24H10.8a6.8 6.8 0 1 1 2.06-13.28A8 8 0 0 1 27.9 15.1 4.9 4.9 0 0 1 23.5 24Z"
          fill="#ffffff"
        />
      </svg>
    ),
    { ...size },
  );
}
