import { describe, expect, it } from "vitest";
import { activeMarkets, chainCatalog, getMarketCatalog } from "../src/markets/catalog.js";
import { deriveMarketStats } from "../src/markets/stats.js";
import { activeSolanaMarkets, getSolanaMarketCatalog } from "../src/markets/solana-catalog.js";
import { weightedBudgets } from "../src/portfolio/allocation.js";

describe("curated meme markets", () => {
  it("keeps every active chain portfolio at 100%", () => {
    const catalog = getMarketCatalog();
    for (const chain of catalog.chains) {
      expect(activeMarkets(chain.slug).reduce((sum, market) => sum + market.weightBps, 0)).toBe(10_000);
    }
    expect(chainCatalog("base").markets.map((market) => market.symbol)).toEqual(["TOSHI", "BRETT", "DEGEN", "BASECAT"]);
    expect(chainCatalog("robinhood").markets.map((market) => market.symbol)).toEqual(["CASHCAT"]);
  });

  it("allocates integer dust to the final market without losing wei", () => {
    const amounts = weightedBudgets(101n, [3_000, 3_000, 2_500, 1_500]);
    expect(amounts).toEqual([30n, 30n, 25n, 16n]);
    expect(amounts.reduce((sum, amount) => sum + amount, 0n)).toBe(101n);
  });

  it("keeps the hidden Solana index at 100% with maintained Meteora pools", () => {
    const catalog = getSolanaMarketCatalog();
    const markets = activeSolanaMarkets();
    expect(catalog.chainId).toBe(792703809);
    expect(markets.map((market) => market.symbol)).toEqual(["FARTCOIN", "USELESS", "PENGU"]);
    expect(markets.reduce((sum, market) => sum + market.weightBps, 0)).toBe(10_000);
    expect(markets.every((market) => market.protocol === "Meteora DLMM" && market.pool.length >= 32)).toBe(true);
  });

  it("labels market returns as trailing estimates derived from live activity", () => {
    const market = activeMarkets("base")[0]!;
    const stats = deriveMarketStats(market, {
      priceUsd: "0.1",
      priceChange: { h24: 12 },
      liquidity: { usd: 1_000_000 },
      volume: { h24: 100_000 },
      marketCap: 50_000_000,
      pairCreatedAt: Date.parse("2025-01-01T00:00:00.000Z"),
      url: "https://dexscreener.com/base/example",
    }, "2026-08-29T00:00:00.000Z");
    expect(stats.trailingFeeAprPct).toBeCloseTo(36.5);
    expect(stats.projectedMonthlyFeesPer1000Usd).toBeCloseTo(30.4167, 3);
    expect(stats.projectionConfidence).toBe("illustrative");
    expect(stats.sourceUrl).toContain("dexscreener.com");
  });

  it("withholds monthly extrapolation when one-day turnover is unstable", () => {
    const market = activeMarkets("base")[3]!;
    const stats = deriveMarketStats(market, {
      liquidity: { usd: 250_000 },
      volume: { h24: 1_500_000 },
      priceChange: { h24: -22 },
      pairCreatedAt: Date.parse("2025-01-01T00:00:00.000Z"),
    }, "2026-08-29T00:00:00.000Z");
    expect(stats.trailingFeeAprPct).toBeGreaterThan(1_000);
    expect(stats.dailyFeesPer1000Usd).toBe(60);
    expect(stats.projectionConfidence).toBe("unstable");
    expect(stats.projectedMonthlyFeesPer1000Usd).toBeNull();
  });
});
