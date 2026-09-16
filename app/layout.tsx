import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/**
 * Plex is a document-grade industrial sans: it holds up at 12px on an office
 * monitor, and its mono companion gives tabular figures for document numbers,
 * tax identifiers and amounts — the three things people compare down a column.
 */
const plexSans = IBM_Plex_Sans({
  variable: "--font-sans",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Moonbook — billing and receivables for any business",
    template: "%s · Moonbook",
  },
  description:
    "Invoice the right party, collect payments, and always know what's outstanding — configured to your industry, not rebuilt for it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
