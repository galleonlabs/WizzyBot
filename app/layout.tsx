import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Unbounded } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const themeBootScript = `(()=>{try{const theme=localStorage.getItem("una-theme");if(theme==="light"||theme==="dark"){document.documentElement.dataset.theme=theme;const meta=document.createElement("meta");meta.name="theme-color";meta.id="una-theme-color";meta.content=theme==="dark"?"#09090d":"#f8f5ef";document.head.appendChild(meta)}}catch{}})()`;

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
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootScript }} /></head>
      <body className={`${sans.variable} ${display.variable} ${sans.className}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
