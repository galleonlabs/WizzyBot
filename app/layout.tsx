import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Una — The Meme Market Maker",
  description: "Deposit once and earn meme-market trading fees across Base, Robinhood, and Solana.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0b10",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${sans.className}`}>
        <span
          hidden
          aria-hidden="true"
          dangerouslySetInnerHTML={{
            __html: `<!--
THESIS: One managed meme-liquidity index leads; all builder mechanics stay behind a single consumer action.
OWN-WORLD: Near-black exchange canvas, warm white type, coral action field, mint performance, three-network labels, and a continuous index pulse.
STORY: Deposit ETH once, let Una make every market, watch trading fees accrue, and withdraw from wallets you control.
FIRST VIEWPORT: A defining observed-fee number and index pulse occupy the left; one amount and one Make markets action anchor the right.
FORM: Meme Index, third dealt surface, seed 1e79c3ce.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
-->`,
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
