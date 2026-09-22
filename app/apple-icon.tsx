import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Same mark as icon.tsx, scaled up for iOS/Android home-screen icons. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <svg width={180} height={180} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M23.5 24H10.8a6.8 6.8 0 1 1 2.06-13.28A8 8 0 0 1 27.9 15.1 4.9 4.9 0 0 1 23.5 24Z"
          fill="#ffffff"
        />
      </svg>
    ),
    { ...size },
  );
}
