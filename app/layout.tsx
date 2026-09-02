import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Unbounded } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Providers } from "./providers";
import "./globals.css";

const themeBootScript = `(()=>{try{const saved=localStorage.getItem("wizzy-theme")||localStorage.getItem("una-theme");const theme=saved==="system"||saved==="light"||saved==="dark"?saved:"dark";if(theme==="system")return;document.documentElement.dataset.theme=theme;const meta=document.createElement("meta");meta.name="theme-color";meta.id="wizzy-theme-color";meta.content=theme==="dark"?"#09090d":"#f8f5ef";document.head.appendChild(meta)}catch{document.documentElement.dataset.theme="dark"}})()`;

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

const display = Unbounded({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-display",
  display: "swap",
});

const siteUrl = "https://wizzy.meme";
const socialTitle = "Wizzy: Meme Yield, Curated";
const socialDescription =
  "Curated meme LP pools on Base and Robinhood Chain. Swap into the exact tokens with Relay, open the position on Uniswap or Aerodrome, and manage it in one place.";
const socialImage = {
  url: "/brand/wizzy-social-unbounded-v1.png",
  width: 1200,
  height: 630,
  alt: "Wizzy mascot beside the words ‘Make Meme Markets’, inviting you to earn trading fees from curated meme pools.",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "Wizzy",
  alternates: { canonical: "/" },
  title: socialTitle,
  description: socialDescription,
  authors: [{ name: "Wizzy", url: siteUrl }],
  creator: "Wizzy",
  publisher: "Wizzy",
  category: "finance",
  keywords: ["meme pools", "LP curator", "Robinhood Chain", "Base", "liquidity", "Relay", "DeFi", "Wizzy"],
  formatDetection: { email: false, address: false, telephone: false },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  openGraph: {
    title: socialTitle,
    description: socialDescription,
    url: "/",
    siteName: "Wizzy",
    locale: "en_GB",
    type: "website",
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    site: "@wizzydotmeme",
    creator: "@wizzydotmeme",
    title: socialTitle,
    description: socialDescription,
    images: [socialImage],
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
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootScript }} /></head>
      <body className={`${sans.variable} ${display.variable} ${sans.className}`}>
        <Providers>{children}</Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
