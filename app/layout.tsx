import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://unabot.vercel.app"),
  title: "Una: Make Meme Markets",
  description: "Deposit ETH into a curated index of meme markets, starting with Robinhood Chain.",
  openGraph: {
    title: "Una: Make Meme Markets",
    description: "The actively curated Robinhood Una Index.",
    siteName: "Una",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Una: Make Meme Markets",
    description: "The actively curated Robinhood Una Index.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f5ef" },
    { media: "(prefers-color-scheme: dark)", color: "#09090d" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${display.variable} ${sans.className}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
