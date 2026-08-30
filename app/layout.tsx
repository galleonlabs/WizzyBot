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

export const metadata: Metadata = {
  metadataBase: new URL("https://wizzy.meme"),
  alternates: { canonical: "/" },
  title: "Wizzy: Make Meme Markets",
  description: "Deposit ETH into a curated index of meme markets and earn, updated and managed by agents on Robinhood Chain.",
  openGraph: {
    title: "Wizzy: Make Meme Markets",
    description: "The actively curated Robinhood Wizzy Index.",
    siteName: "Wizzy",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Wizzy: Make Meme Markets",
    description: "The actively curated Robinhood Wizzy Index.",
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
