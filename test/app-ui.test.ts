import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/page.tsx", "utf8");
const portfolio = readFileSync("app/portfolio-app.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");
const providers = readFileSync("app/providers.tsx", "utf8");
const mascot = readFileSync("public/brand/una-mascot.svg", "utf8");
const nextConfig = readFileSync("next.config.ts", "utf8");

describe("meme index product UI", () => {
  it("leads with one consumer market-making action and honest market evidence", () => {
    expect(page).toContain("PortfolioApp");
    expect(portfolio).toContain("Make Meme Markets");
    expect(portfolio).toContain("Deposit ETH into a curated index of meme markets, starting with Robinhood Chain.");
    expect(portfolio).toContain("Make markets");
    expect(portfolio).toContain("Fee APR");
    expect(portfolio).toContain("Based on 24h fees");
    expect(portfolio).toContain("Inside the index");
    expect(portfolio).toContain("Earning now");
    expect(portfolio).toContain('{ id: "markets", label: "Markets" }');
    expect(portfolio).toContain('id="positions"');
    expect(portfolio).toContain("More with a larger deposit");
    expect(portfolio).toContain("Pay from");
    expect(portfolio).toContain('name="depositAmount"');
    expect(portfolio).toContain('name="sourceChain"');
    expect(portfolio).toContain("One wallet. Your markets.");
    expect(portfolio).not.toContain('label: "Positions"');
    expect(portfolio).not.toContain("scrollIntoView");
    expect(portfolio).toContain('const FOMO_URL = "https://fomo.family/"');
    expect(portfolio).toContain("https://www.geckoterminal.com/robinhood/pools");
    expect(portfolio).toContain("https://app.uniswap.org/swap?chain=robinhood");
    expect(portfolio).not.toMatch(/build your allocation|portfolio split|chain selector/i);
    expect(portfolio).not.toMatch(/autopilot|guaranteed returns|UnaBot/i);
    expect(portfolio).not.toMatch(/Observed, not forecast|Positions stay yours|Ask Una/i);
    expect(portfolio).not.toMatch(/one deposit · every market|self-custodial by design/i);
    expect(portfolio).not.toMatch(/Una is independent|not affiliated/i);
  });

  it("pairs a characterful display face with a restrained trading UI", () => {
    expect(layout).toContain("Unbounded");
    expect(layout).toContain("Plus_Jakarta_Sans");
    expect(layout).not.toContain("Bricolage_Grotesque");
    expect(layout).not.toContain("Instrument_Serif");
    expect(css).toContain("font-family: var(--font-display)");
    expect(css).toContain("--coral: #ff6f83");
    expect(css).toContain("--canvas: #09090d");
    expect(css).toContain("--surface: #111116");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(':root[data-theme="dark"]');
    expect(layout).toContain('localStorage.getItem("una-theme")');
    expect(portfolio).toContain('Theme: ${capitalize(theme)}');
    expect(css).not.toMatch(/#FC72FF|#FF37C7|#ff007a/i);
    expect(css).not.toContain("Instrument Serif");
    expect(css).not.toMatch(/gradient/i);
  });

  it("gives the hooded mascot a crystal staff without a coral hand", () => {
    expect(mascot).toContain("crystal-tipped staff");
    expect(mascot).toContain('stroke="#4f4a54"');
    expect(mascot).toContain('fill="#77e8c9"');
    expect(mascot).not.toMatch(/#ff6f83|#e85570/i);
  });

  it("keeps Una eye-first at icon scale", () => {
    expect(mascot).toContain('rx="15.5" ry="22.5"');
    expect(mascot).toContain('rx="5" ry="7"');
    expect(mascot).not.toContain('rx="9" ry="13"');
  });

  it("keeps Una one near-circular hooded blob with no neck, tiny limbs, and an oversized staff", () => {
    expect(mascot).toContain("near-circular hooded light blob with no neck");
    expect(mascot).toContain("tiny hands and feet");
    expect(mascot).toContain("M72 44C77 23 93 10 113 10");
    expect(mascot).toContain("M89 219c-3 3-4 8-1 11");
    expect(mascot).toContain("m221 11 20 23-20 25-18-25 18-23Z");
    expect(mascot).not.toContain('ellipse cx="109" cy="166"');
  });

  it("keeps the launch surface Robinhood-specific while preserving self-custody", () => {
    expect(portfolio).toContain("Robinhood Una Index");
    expect(portfolio).toContain("Una agents regularly review which markets qualify.");
    expect(portfolio).toContain("Actively curated as meme markets change.");
    expect(portfolio).toContain('brand="robinhood"');
    expect(portfolio).toContain('uniswap: "https://');
    expect(portfolio).toContain("Self-custodial");
    expect(portfolio).toContain("Two wallet approvals: deposit from");
    expect(portfolio).toContain('useState("1.00")');
    expect(portfolio).toContain('loading ? "Reading markets"');
    expect(portfolio).not.toContain("loading ? INDEX_MARKET_COUNT : constituentCount");
    expect(portfolio).toContain("Ready to collect");
    expect(portfolio).not.toContain("Your liquidity and the index, in one place.");
    expect(portfolio).not.toContain("Deposit ETH. Earn trading fees across Base, Robinhood, and Solana.");
    expect(css).toContain(".index-hero { grid-template-columns: 1fr; gap: 48px; padding: 68px 0 64px");
    expect(css).toContain("min-height: 44px");
    expect(css).not.toContain("position: fixed");
  });

  it("provisions a Privy Solana wallet for new and existing email users", () => {
    expect(providers).toContain('loginMethods: ["email"]');
    expect(providers).toContain('solana: { createOnLogin: "all-users" }');
    expect(providers).toContain('"solana:mainnet"');
  });

  it("allows every reviewed market and product-image host without weakening the rest of the image policy", () => {
    expect(nextConfig).toContain(
      "img-src 'self' data: blob: https://coin-images.coingecko.com https://assets.geckoterminal.com https://cdn.dexscreener.com https://assets.relay.link https://avatars.githubusercontent.com https://fomo.family https://www.geckoterminal.com",
    );
    expect(nextConfig).not.toContain("img-src *");
  });
});
