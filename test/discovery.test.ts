import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ageDaysFrom,
  catalogFallbackSnapshot,
  curatePools,
  feeApr,
  mergeSnapshots,
  feePipsFromName,
  normalizeGeckoPools,
  parseSecurityReport,
  venueForDex,
  type RawPool,
  type SecurityReport,
} from "../src/markets/discovery.js";
import { getMarketCatalog } from "../src/markets/catalog.js";

const robinhoodFixture = JSON.parse(readFileSync("test/fixtures/gecko-robinhood-uniswap-v3.json", "utf8"));
const baseFixture = JSON.parse(readFileSync("test/fixtures/gecko-base-uniswap-v3.json", "utf8"));
const NOW = Date.parse("2026-09-02T12:00:00Z");

describe("meme pool discovery", () => {
  it("normalises GeckoTerminal rows with tokens, dex, liquidity, volume, and age", () => {
    const rows = normalizeGeckoPools("robinhood", robinhoodFixture);
    expect(rows.length).toBe(8);
    const cashcat = rows.find((row) => row.name.startsWith("CASHCAT"))!;
    expect(cashcat.dex).toBe("uniswap-v3-robinhood");
    expect(cashcat.quote.symbol).toBe("WETH");
    expect(cashcat.liquidityUsd).toBeGreaterThan(1_000_000);
    expect(cashcat.volume24hUsd).toBeGreaterThan(1_000_000);
    expect(cashcat.txns24h).toBeGreaterThan(0);
    expect(cashcat.createdAt).toMatch(/^\d{4}-/);
  });

  it("keeps ETH-quoted meme pools and drops majors, stables, and tokenised stocks", () => {
    const raw = [...normalizeGeckoPools("robinhood", robinhoodFixture), ...normalizeGeckoPools("base", baseFixture)];
    const { pools, excluded } = curatePools({ raw, security: new Map(), securityChecked: new Set(), now: NOW });
    const symbols = pools.map((pool) => pool.token.symbol);
    expect(symbols).toContain("CASHCAT");
    expect(symbols).toContain("AI");
    expect(symbols).toContain("PONS");
    expect(symbols).not.toContain("USDG");
    expect(symbols).not.toContain("NVDA");
    expect(symbols).not.toContain("SPY");
    expect(symbols).not.toContain("USDC");
    expect(symbols).not.toContain("cbBTC");
    expect(excluded.some((entry) => entry.reason === "not a meme")).toBe(true);
    expect(excluded.some((entry) => entry.reason === "not an ETH pair")).toBe(true);
    expect(pools.every((pool) => pool.quote.symbol === "WETH" || pool.quote.symbol === "ETH")).toBe(true);
    expect(pools[0]!.volume24hUsd).toBeGreaterThanOrEqual(pools.at(-1)!.volume24hUsd);
  });

  it("applies liquidity floors, flags early and thin pools, and never drops reviewed markets for size", () => {
    const meme = (overrides: Partial<RawPool>): RawPool => ({
      chain: "base",
      dex: "uniswap-v3-base",
      pool: "0x1000000000000000000000000000000000000001",
      name: "DOG / WETH 1%",
      base: { address: "0x2000000000000000000000000000000000000002", symbol: "DOG", name: "Dog", imageUrl: null },
      quote: { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", name: "Wrapped Ether", imageUrl: null },
      priceUsdBase: 0.001,
      priceUsdQuote: 2400,
      priceChange24h: 4,
      liquidityUsd: 12_000,
      volume24hUsd: 500,
      txns24h: 40,
      createdAt: new Date(NOW - 86_400_000).toISOString(),
      ...overrides,
    });
    const reviewedMarket = getMarketCatalog().chains.find((chain) => chain.slug === "base")!.markets.find((market) => market.status === "active" && market.protocol === "V3")!;
    const catalog = new Map([[`base:${reviewedMarket.pool.toLowerCase()}`, { ...reviewedMarket, chain: "base" as const }]]);
    const raw = [
      meme({}),
      meme({ pool: "0x1000000000000000000000000000000000000002", liquidityUsd: 900 }),
      meme({ pool: "0x1000000000000000000000000000000000000003", liquidityUsd: 80_000, volume24hUsd: 0, createdAt: new Date(NOW - 30 * 86_400_000).toISOString() }),
      meme({ pool: reviewedMarket.pool, base: { address: reviewedMarket.token, symbol: reviewedMarket.symbol, name: reviewedMarket.name, imageUrl: null }, liquidityUsd: 500, volume24hUsd: 10 }),
    ];
    const { pools, excluded } = curatePools({ raw, security: new Map(), securityChecked: new Set(["base"]), catalog, now: NOW });
    expect(pools.map((pool) => pool.pool)).toEqual([raw[0]!.pool, reviewedMarket.pool]);
    expect(pools[0]!.flags).toEqual(["unchecked", "new", "thin", "quiet"]);
    expect(pools[0]!.fee).toBe(10_000);
    expect(pools[0]!.feeApr24hPct).toBeCloseTo(feeApr(500, 12_000, 10_000)!, 6);
    expect(pools[1]!.reviewed).toBe(true);
    expect(pools[1]!.flags[0]).toBe("reviewed");
    expect(pools[1]!.marketId).toBe(reviewedMarket.id);
    expect(excluded.map((entry) => entry.reason).sort()).toEqual(["dead", "liquidity"]);
  });

  it("removes honeypots and high-tax tokens and flags the softer warnings", () => {
    const report = (overrides: Partial<SecurityReport>): SecurityReport => ({
      honeypot: false, cannotSellAll: false, ownerChangeBalance: false, selfDestruct: false, buyTaxPct: 0, sellTaxPct: 0,
      openSource: true, mintable: false, pausable: false, blacklist: false, hiddenOwner: false, proxy: false, ...overrides,
    });
    const row = (index: number, symbol: string): RawPool => ({
      chain: "base",
      dex: "aerodrome-slipstream",
      pool: `0x10000000000000000000000000000000000000${index}0`,
      name: `${symbol} / WETH 1%`,
      base: { address: `0x20000000000000000000000000000000000000${index}0`, symbol, name: symbol, imageUrl: null },
      quote: { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", name: "Wrapped Ether", imageUrl: null },
      priceUsdBase: 1,
      priceUsdQuote: 2400,
      priceChange24h: 0,
      liquidityUsd: 100_000,
      volume24hUsd: 50_000,
      txns24h: 100,
      createdAt: new Date(NOW - 30 * 86_400_000).toISOString(),
    });
    const security = new Map<string, SecurityReport>([
      ["base:0x2000000000000000000000000000000000000010", report({ honeypot: true })],
      ["base:0x2000000000000000000000000000000000000020", report({ sellTaxPct: 25 })],
      ["base:0x2000000000000000000000000000000000000030", report({ mintable: true, openSource: false, buyTaxPct: 2 })],
      ["base:0x2000000000000000000000000000000000000040", report({})],
    ]);
    const { pools, excluded } = curatePools({
      raw: [row(1, "TRAP"), row(2, "TAXED"), row(3, "MINTY"), row(4, "CLEAN")],
      security,
      securityChecked: new Set(["base"]),
      onchain: new Map([["base:0x1000000000000000000000000000000000000040", { fee: 2111, tickSpacing: 200 }]]),
      now: NOW,
    });
    expect(pools.map((pool) => pool.token.symbol)).toEqual(["MINTY", "CLEAN"]);
    expect(excluded.filter((entry) => entry.reason === "security")).toHaveLength(2);
    expect(pools[0]!.flags).toEqual(["unverified", "mintable", "tax"]);
    expect(pools[1]!.flags).toEqual([]);
    expect(pools[1]!.tickSpacing).toBe(200);
    expect(pools[1]!.fee).toBe(2111);
    expect(pools[1]!.venueLabel).toBe("Aerodrome Slipstream");
  });

  it("keeps the last good chain sweep when a refresh comes back degraded", () => {
    const base = { id: "base:1", chain: "base" as const, volume24hUsd: 5 } as never;
    const robinhood = { id: "robinhood:1", chain: "robinhood" as const, volume24hUsd: 9 } as never;
    const previous = { pools: [base, robinhood], asOf: "2026-09-02T10:00:00.000Z", scanned: 2, excluded: 0, degraded: [] };
    const partial = { pools: [base], asOf: "2026-09-02T10:10:00.000Z", scanned: 1, excluded: 0, degraded: ["rate limit"] };
    const merged = mergeSnapshots(previous, partial);
    expect(merged.pools.map((pool) => pool.id)).toEqual(["robinhood:1", "base:1"]);
    expect(merged.degraded).toHaveLength(2);
    const clean = { ...partial, degraded: [] };
    expect(mergeSnapshots(previous, clean)).toBe(clean);
    expect(mergeSnapshots(undefined, partial)).toBe(partial);
  });

  it("falls back to the reviewed catalog when every upstream is down", () => {
    const fallback = catalogFallbackSnapshot(NOW);
    expect(fallback.pools.length).toBeGreaterThanOrEqual(20);
    expect(fallback.pools.every((pool) => pool.reviewed && pool.flags[0] === "reviewed")).toBe(true);
    expect(fallback.pools.some((pool) => pool.chain === "robinhood")).toBe(true);
    expect(fallback.pools.some((pool) => pool.venue === "aerodrome-slipstream" && pool.tickSpacing)).toBe(true);
    expect(fallback.degraded[0]).toContain("reviewed markets only");
  });

  it("parses fee tiers, ages, dex venues, and GoPlus reports", () => {
    expect(feePipsFromName("CASHCAT / WETH 0.3%")).toBe(3000);
    expect(feePipsFromName("BRETT / WETH 1%")).toBe(10_000);
    expect(feePipsFromName("OPAL / WETH")).toBeNull();
    expect(ageDaysFrom(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBeCloseTo(2, 6);
    expect(ageDaysFrom(null, NOW)).toBeNull();
    expect(venueForDex("uniswap-v3-robinhood")).toBe("uniswap-v3");
    expect(venueForDex("aerodrome-slipstream-3")).toBe("aerodrome-slipstream");
    expect(venueForDex("pancakeswap-v3-base")).toBeUndefined();
    expect(parseSecurityReport({ is_honeypot: "1", buy_tax: "0.05", is_open_source: "0", is_mintable: "1" })).toMatchObject({ honeypot: true, buyTaxPct: 5, openSource: false, mintable: true });
    expect(parseSecurityReport(null)).toBeNull();
  });
});
