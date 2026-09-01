import { describe, expect, it } from "vitest";
import { activeMarkets, chainCatalog, getMarketCatalog, parseMarketCatalog } from "../src/markets/catalog.js";
import { deriveGeckoMarketStats, deriveMarketStats } from "../src/markets/stats.js";
import { activeSolanaMarkets, getSolanaMarketCatalog } from "../src/markets/solana-catalog.js";
import { deriveSolanaMarketStats } from "../src/markets/solana-stats.js";
import { liquidityVenueFor } from "../src/portfolio/allocation.js";

describe("curated meme markets", () => {
  it("keeps every reviewed market uniquely addressable without chain allocations", () => {
    const catalog = getMarketCatalog();
    for (const chain of catalog.chains) {
      const active = activeMarkets(chain.slug);
      expect(active.length).toBeGreaterThan(0);
      expect(new Set(active.map((market) => market.symbol)).size).toBe(active.length);
      expect(active.every((market) => !("weightBps" in market))).toBe(true);
    }
    expect(chainCatalog("base").markets.find((market) => market.symbol === "BRETT")?.protocol).toBe("AERODROME_SLIPSTREAM");
    const cashcat = chainCatalog("robinhood").markets.find((market) => market.id === "robinhood-cashcat")!;
    expect(cashcat.pool.toLowerCase()).toBe("0xd42a491087a15e5afd51feb3606066cc152d2b09");
    expect(cashcat).toMatchObject({ fee: 3000, tickSpacing: 60 });
  });

  it("offers only reviewed per-market V2 and V4 alternatives", () => {
    const brett = activeMarkets("base").find((market) => market.symbol === "BRETT")!;
    const basecat = activeMarkets("base").find((market) => market.symbol === "BASECAT")!;
    const cashcat = activeMarkets("robinhood").find((market) => market.symbol === "CASHCAT")!;
    expect(brett.liquidityVenues.map((venue) => venue.protocol)).toEqual(["V2", "V4"]);
    expect(cashcat.liquidityVenues.map((venue) => venue.protocol)).toEqual(["V2", "V4"]);
    expect(basecat.liquidityVenues).toEqual([]);
    expect(liquidityVenueFor(brett, "V2")).toMatchObject({ protocol: "V2", pool: "0xb34380BA6a17B022782c7FC91e319C10c168FB98" });
    expect(() => liquidityVenueFor(basecat, "V4")).toThrow("no reviewed Uniswap V4 pool");
  });

  it("accepts a reviewed market replacement without allocation weights", () => {
    const candidate = structuredClone(getMarketCatalog());
    const robinhood = candidate.chains.find((chain) => chain.slug === "robinhood")!;
    const outgoing = robinhood.markets.find((market) => market.id === "robinhood-cashcat")!;
    outgoing.status = "paused";
    robinhood.markets.push({ ...outgoing, id: "robinhood-cashcat-next", name: "Cashcat Next", symbol: "CASHNEXT", status: "active" });
    expect(() => parseMarketCatalog(candidate)).not.toThrow();
    expect(robinhood.markets.at(-1)).not.toHaveProperty("weightBps");
  });

  it("keeps the legacy Solana catalog at 100% with maintained Meteora pools", () => {
    const catalog = getSolanaMarketCatalog();
    const markets = activeSolanaMarkets();
    expect(catalog.chainId).toBe(792703809);
    expect(markets.map((market) => market.symbol)).toEqual(["FARTCOIN", "USELESS"]);
    expect(markets.every((market) => !("weightBps" in market))).toBe(true);
    expect(markets.every((market) => market.protocol === "Meteora DLMM" && market.pool.length >= 32)).toBe(true);
    expect(deriveSolanaMarketStats(markets[0]!, { info: { imageUrl: "https://cdn.example/solana.png" } }).tokenImageUrl).toBe("https://cdn.example/solana.png");
  });

  it("labels market returns as trailing estimates derived from live activity", () => {
    const market = activeMarkets("base")[1]!;
    const stats = deriveMarketStats(market, {
      priceUsd: "0.1",
      priceChange: { h24: 12 },
      liquidity: { usd: 1_000_000 },
      volume: { h24: 100_000 },
      marketCap: 50_000_000,
      pairCreatedAt: Date.parse("2025-01-01T00:00:00.000Z"),
      url: "https://dexscreener.com/base/example",
      info: { imageUrl: "https://cdn.example/basecat.png" },
    }, "2026-08-29T00:00:00.000Z");
    expect(stats.trailingFeeAprPct).toBeCloseTo(36.5);
    expect(stats.projectedMonthlyFeesPer1000Usd).toBeCloseTo(30.4167, 3);
    expect(stats.projectionConfidence).toBe("illustrative");
    expect(stats.sourceUrl).toContain("dexscreener.com");
    expect(stats.tokenImageUrl).toBe("https://cdn.example/basecat.png");
  });

  it("uses a live Slipstream fee for Aerodrome fee pace", () => {
    const market = activeMarkets("base").find((candidate) => candidate.symbol === "BRETT")!;
    const stats = deriveMarketStats(market, {
      liquidity: { usd: 1_000_000 },
      volume: { h24: 100_000 },
      pairCreatedAt: Date.parse("2025-01-01T00:00:00.000Z"),
    }, "2026-08-29T00:00:00.000Z", 2_500);
    expect(stats.feePips).toBe(2_500);
    expect(stats.dailyFeesPer1000Usd).toBe(0.25);
  });

  it("uses GeckoTerminal as the Robinhood evidence and token-image source", () => {
    const market = activeMarkets("robinhood")[0]!;
    const tokenId = `robinhood_${market.token.toLowerCase()}`;
    const stats = deriveGeckoMarketStats(market, {
      id: `robinhood_${market.pool.toLowerCase()}`,
      attributes: {
        address: market.pool.toLowerCase(),
        base_token_price_usd: "0.02",
        quote_token_price_usd: "2450",
        price_change_percentage: { h24: "4.2" },
        reserve_in_usd: "2500000",
        volume_usd: { h24: "17500000" },
        fdv_usd: "20000000",
        pool_created_at: "2026-07-01T00:00:00.000Z",
      },
      relationships: {
        base_token: { data: { id: tokenId } },
        quote_token: { data: { id: `robinhood_${market.quoteToken.toLowerCase()}` } },
      },
    }, [{ id: tokenId, attributes: { address: market.token, image_url: "https://assets.geckoterminal.com/cashcat" } }], "2026-08-30T00:00:00.000Z");
    expect(stats.priceUsd).toBe(0.02);
    expect(stats.liquidityUsd).toBe(2_500_000);
    expect(stats.trailingFeeAprPct).toBeCloseTo(766.5);
    expect(stats.sourceUrl).toBe(`https://www.geckoterminal.com/robinhood/pools/${market.pool.toLowerCase()}`);
    expect(stats.tokenImageUrl).toBe("https://assets.geckoterminal.com/cashcat");
  });

  it("withholds monthly extrapolation when one-day turnover is unstable", () => {
    const market = activeMarkets("base")[1]!;
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
