import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("app/page.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");
const cockpit = readFileSync("app/cockpit.tsx", "utf8");
const panel = readFileSync("app/lp-panel.tsx", "utf8");
const nav = readFileSync("app/top-nav.tsx", "utf8");

describe("cute consumer UI", () => {
  it("keeps the landing line roman and the product copy", () => {
    expect(page).toContain("Liquidity, as an agent.");
    expect(page).not.toMatch(/<em>/);
    expect(page).toContain("v2, v3, and v4. You hold the NFT.");
    expect(page).toContain("Dry-run first. Confirm to go live.");
    expect(page).not.toMatch(/autopilot|Galleon|you keep the position/i);
    expect(nav).toContain("Una");
    expect(nav).not.toContain("UnaBot");
  });

  it("uses Plus Jakarta Sans and the bubblegum token set", () => {
    expect(layout).toContain("Plus_Jakarta_Sans");
    expect(layout).not.toContain("Instrument_Serif");
    expect(css).toContain("--accent: #ff8fa3");
    expect(css).toContain("--bg: #0b0b10");
    expect(css).toContain("--card: #16161d");
    expect(css).not.toMatch(/#FC72FF|#FF37C7|#ff007a/i);
    expect(css).not.toContain("Instrument Serif");
  });

  it("designs mobile as tabs, fat cards, and a detail sheet", () => {
    expect(cockpit).toContain('className="app-tabs"');
    expect(cockpit).toContain("sheetOpen");
    expect(cockpit).toContain('params.get("detail")');
    expect(panel).toContain("lp-back");
    expect(panel).toContain("data-sheet");
    expect(css).toContain(".app-tabs button.is-on");
    expect(css).toContain("env(safe-area-inset-bottom");
    expect(css).toContain('data-sheet="open"');
    expect(css).toContain("min-height: 48px");
  });
});
