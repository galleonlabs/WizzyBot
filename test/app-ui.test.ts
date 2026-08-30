import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/page.tsx", "utf8");
const portfolio = readFileSync("app/portfolio-app.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");
const providers = readFileSync("app/providers.tsx", "utf8");

describe("meme index product UI", () => {
  it("leads with one consumer market-making action and honest market evidence", () => {
    expect(page).toContain("PortfolioApp");
    expect(portfolio).toContain("Be the market maker");
    expect(portfolio).toContain("Deposit ETH. Una puts it to work across six meme markets on Robinhood Chain.");
    expect(portfolio).toContain("Make markets");
    expect(portfolio).toContain("Fee APR");
    expect(portfolio).toContain("Based on 24h fees");
    expect(portfolio).toContain("Inside the index");
    expect(portfolio).toContain("Earning now");
    expect(portfolio).toContain('{ id: "markets", label: "Markets" }');
    expect(portfolio).toContain('id="positions"');
    expect(portfolio).toContain("More with a larger deposit");
    expect(portfolio).toContain("Pay from");
    expect(portfolio).toContain("One wallet. Your markets.");
    expect(portfolio).not.toContain('label: "Positions"');
    expect(portfolio).not.toContain("scrollIntoView");
    expect(portfolio).toContain("https://fomo.family/r/andrewwilkinson");
    expect(portfolio).toContain("https://www.geckoterminal.com/robinhood/pools");
    expect(portfolio).toContain("https://app.uniswap.org/swap?chain=robinhood");
    expect(portfolio).not.toMatch(/build your allocation|portfolio split|chain selector/i);
    expect(portfolio).not.toMatch(/autopilot|guaranteed returns|UnaBot/i);
    expect(portfolio).not.toMatch(/Observed, not forecast|Positions stay yours|Ask Una/i);
    expect(portfolio).not.toMatch(/one deposit · every market|self-custodial by design/i);
    expect(portfolio).not.toMatch(/Una is independent|not affiliated/i);
  });

  it("uses Plus Jakarta Sans and the approved index palette", () => {
    expect(layout).toContain("Plus_Jakarta_Sans");
    expect(layout).not.toContain("Instrument_Serif");
    expect(css).toContain("--coral: #ff6f83");
    expect(css).toContain("--canvas: #09090d");
    expect(css).toContain("--surface: #111116");
    expect(css).not.toMatch(/#FC72FF|#FF37C7|#ff007a/i);
    expect(css).not.toContain("Instrument Serif");
    expect(css).not.toMatch(/gradient/i);
  });

  it("keeps the launch surface Robinhood-specific while preserving self-custody", () => {
    expect(portfolio).toContain("Una meme index on Robinhood Chain");
    expect(portfolio).toContain('brand="robinhood"');
    expect(portfolio).toContain('uniswap: "https://');
    expect(portfolio).toContain("Self-custodial");
    expect(portfolio).toContain("Two wallet approvals: deposit from");
    expect(portfolio).toContain('useState("1")');
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
});
