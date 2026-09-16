import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

/** Every LAN address this machine currently has — lets the app be opened from
 *  a phone on the same Wi-Fi during dev without a cross-origin WebSocket error. */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .filter((n) => n.family === "IPv4" && !n.internal)
    .map((n) => n.address);
}

const nextConfig: NextConfig = {
  allowedDevOrigins: lanAddresses(),
  devIndicators: false,

  // @react-pdf/renderer must not be bundled: it resolves fonts and its own
  // reconciler at runtime, and webpack's rewriting breaks both.
  serverExternalPackages: ["@react-pdf/renderer"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
