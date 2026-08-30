import { describe, expect, it } from "vitest";
import { activeMarkets, chainCatalog, getMarketCatalog, parseMarketCatalog } from "../src/markets/catalog.js";
import { deriveGeckoMarketStats, deriveMarketStats } from "../src/markets/stats.js";
import { activeSolanaMarkets, getSolanaMarketCatalog } from "../src/markets/solana-catalog.js";
import { deriveSolanaMarketStats } from "../src/markets/solana-stats.js";
import { weightedBudgets } from "../src/portfolio/allocation.js";

describe("curated meme markets", () => {
  it("keeps every active chain portfolio at 100%", () => {
    const catalog = getMarketCatalog();
    expect(catalog.migrations).toEqual([]);
    for (const chain of catalog.chains) {
      expect(activeMarkets(chain.slug).reduce((sum, market) => sum + market.weightBps, 0)).toBe(10_000);
    }
    expect(activeMarkets("base").map((market) => market.symbol)).toEqual(["BRETT", "BASECAT"]);
    expect(chainCatalog("base").markets.find((market) => market.symbol === "BRETT")?.protocol).toBe("AERODROME_SLIPSTREAM");
    expect(activeMarkets("robinhood").map((market) => market.symbol)).toEqual(["CASHCAT", "PONS", "AI", "CHUMP", "STONKBROKER", "PONSGUY"]);
    expect(chainCatalog("robinhood").markets[0]?.pool.toLowerCase()).toBe("0xd42a491087a15e5afd51feb3606066cc152d2b09");
    expect(chainCatalog("robinhood").markets[0]).toMatchObject({ fee: 3000, tickSpacing: 60 });
  });

  it("allocates integer dust to the final market without losing wei", () => {
    const amounts = weightedBudgets(101n, [3_000, 3_000, 2_500, 1_500]);
    expect(amounts).toEqual([30n, 30n, 25n, 16n]);
    expect(amounts.reduce((sum, amount) => sum + amount, 0n)).toBe(101n);
  });

  it("only accepts curator migrations that preserve the outgoing index slot", () => {
    const candidate = structuredClone(getMarketCatalog());
    const robinhood = candidate.chains.find((chain) => chain.slug === "robinhood")!;
    const outgoing = robinhood.markets.find((market) => market.id === "robinhood-cashcat")!;
    outgoing.status = "paused";
    robinhood.markets.push({ ...outgoing, id: "robinhood-cashcat-next", name: "Cashcat Next", symbol: "CASHNEXT", status: "active" });
    candidate.migrations.push({
      id: "cashcat-next",
      chain: "robinhood",
      fromMarketId: outgoing.id,
      toMarketId: "robinhood-cashcat-next",
      effectiveAt: "2026-08-30",
    });

    expect(() => parseMarketCatalog(candidate)).not.toThrow();
    robinhood.markets.at(-1)!.weightBps -= 1;
    expect(() => parseMarketCatalog(candidate)).toThrow("active market weights must sum to 10,000 bps");
  });

  it("keeps the hidden Solana index at 100% with maintained Meteora pools", () => {
    const catalog = getSolanaMarketCatalog();
    const markets = activeSolanaMarkets();
    expect(catalog.chainId).toBe(792703809);
    expect(markets.map((market) => market.symbol)).toEqual(["FARTCOIN", "USELESS"]);
    expect(markets.reduce((sum, market) => sum + market.weightBps, 0)).toBe(10_000);
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
