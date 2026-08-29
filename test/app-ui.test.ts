import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/page.tsx", "utf8");
const portfolio = readFileSync("app/portfolio-app.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");

describe("meme index product UI", () => {
  it("leads with one consumer market-making action and honest market evidence", () => {
    expect(page).toContain("PortfolioApp");
    expect(portfolio).toContain("The meme market maker");
    expect(portfolio).toContain("Deposit ETH once");
    expect(portfolio).toContain("Make markets");
    expect(portfolio).toContain("Pool fees yesterday");
    expect(portfolio).toContain("evidence, not a return forecast");
    expect(portfolio).toContain("Eight markets. One index.");
    expect(portfolio).not.toMatch(/build your allocation|portfolio split|chain selector/i);
    expect(portfolio).not.toMatch(/autopilot|guaranteed returns|UnaBot/i);
    expect(portfolio).not.toMatch(/one deposit · every market|self-custodial by design/i);
  });

  it("uses Plus Jakarta Sans and the approved index palette", () => {
    expect(layout).toContain("Plus_Jakarta_Sans");
    expect(layout).not.toContain("Instrument_Serif");
    expect(css).toContain("--coral: #ff6f83");
    expect(css).toContain("--canvas: #09090d");
    expect(css).toContain("--surface: #111116");
    expect(css).not.toMatch(/#FC72FF|#FF37C7|#ff007a/i);
    expect(css).not.toContain("Instrument Serif");
  });

  it("keeps the tri-chain index, custody, and responsive navigation explicit", () => {
    expect(portfolio).toContain("Base · Robinhood · Solana");
    expect(portfolio).toContain("Base · Aero");
    expect(portfolio).toContain("Keep every position");
    expect(portfolio).toContain("approvals across Base, Robinhood, and Solana");
    expect(portfolio).toContain("Each approval creates positions you own");
    expect(css).toContain(".index-hero { grid-template-columns: 1fr");
    expect(css).toContain("min-height: 44px");
    expect(css).not.toContain("position: fixed");
  });
});
