import { describe, expect, it } from "vitest";
import { addressesFor } from "../src/chains.js";
import { chainCatalog } from "../src/markets/catalog.js";
import { deriveDexVenueObservations, deriveVenueObservations, fetchVenueObservations, type DexVenuePayload, type GeckoVenuePayload } from "../src/markets/venue-observations.js";

describe("venue observations", () => {
  it("matches live pools to every reviewed venue and verifies the token pair", () => {
    const market = chainCatalog("base").markets.find((candidate) => candidate.id === "base-toshi")!;
    const v2 = market.liquidityVenues.find((venue) => venue.protocol === "V2")!;
    const v4 = market.liquidityVenues.find((venue) => venue.protocol === "V4")!;
    const payload: GeckoVenuePayload = {
      data: [
        pool(market.pool, market.token, market.quoteToken, "uniswap-v3-base", 1_200_000, 400_000, "1"),
        pool(v2.pool, market.token, market.quoteToken, "uniswap-v2-base", 600_000, 500_000),
        pool(v4.poolId, market.token, addressesFor("base").nativeEth, "uniswap-v4-base", 900_000, 800_000, "0.3"),
      ],
    };

    const observations = deriveVenueObservations("base", market, payload, "2026-09-01T20:00:00.000Z", 100_000_000n);

    expect(observations.map((observation) => observation.key)).toEqual(["PRIMARY", "V2", "V4"]);
    expect(observations.every((observation) => observation.pairVerified && observation.executable)).toBe(true);
    expect(observations.find((observation) => observation.key === "V4")).toMatchObject({
      protocol: "V4",
      liquidityUsd: 900_000,
      feePips: 3_000,
    });
    expect(observations.every((observation) => (observation.estimatedEntryCostUsd ?? 0) > 0)).toBe(true);
  });

  it("marks a mismatched or missing pool as ineligible evidence", () => {
    const market = chainCatalog("base").markets.find((candidate) => candidate.id === "base-toshi")!;
    const payload: GeckoVenuePayload = {
      data: [pool(market.pool, "0x1111111111111111111111111111111111111111", market.quoteToken, "uniswap-v3-base", 1_000_000, 200_000, "1")],
    };

    const observations = deriveVenueObservations("base", market, payload, "2026-09-01T20:00:00.000Z");

    expect(observations.find((observation) => observation.key === "PRIMARY")?.pairVerified).toBe(false);
    expect(observations.find((observation) => observation.key === "V2")).toMatchObject({
      pairVerified: false,
      liquidityUsd: null,
      volume24hUsd: null,
    });
  });

  it("derives the same evidence from the higher-capacity Dexscreener feed", () => {
    const market = chainCatalog("base").markets.find((candidate) => candidate.id === "base-toshi")!;
    const v4 = market.liquidityVenues.find((venue) => venue.protocol === "V4")!;
    const payload: DexVenuePayload = {
      pairs: [{
        pairAddress: v4.poolId,
        dexId: "uniswap",
        labels: ["v4"],
        baseToken: { address: market.token },
        quoteToken: { address: addressesFor("base").nativeEth },
        priceChange: { h24: 3 },
        liquidity: { usd: 900_000 },
        volume: { h24: 800_000 },
        pairCreatedAt: Date.parse("2025-01-01T00:00:00.000Z"),
      }],
    };

    expect(deriveDexVenueObservations("base", market, payload, "2026-09-01T20:00:00.000Z").find((venue) => venue.key === "V4")).toMatchObject({
      pairVerified: true,
      liquidityUsd: 900_000,
      volume24hUsd: 800_000,
      feePips: 3_000,
    });
  });

  it("falls back to GeckoTerminal when the primary evidence feed is unavailable", async () => {
    const market = chainCatalog("base").markets.find((candidate) => candidate.id === "base-toshi")!;
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      if (calls === 1) throw new Error("primary feed unavailable");
      return new Response(JSON.stringify({
        data: [pool(market.pool, market.token, market.quoteToken, "uniswap-v3-base", 1_200_000, 400_000, "1")],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const observations = await fetchVenueObservations("base", market, {
      observedAt: "2026-09-01T20:00:00.000Z",
      fetcher: fetcher as typeof fetch,
    });

    expect(calls).toBe(2);
    expect(observations.find((observation) => observation.key === "PRIMARY")).toMatchObject({
      pairVerified: true,
      liquidityUsd: 1_200_000,
    });
  });
});

function pool(
  address: string,
  baseToken: string,
  quoteToken: string,
  dex: string,
  reserve: number,
  volume: number,
  fee?: string,
) {
  return {
    attributes: {
      address,
      pool_fee_percentage: fee,
      pool_created_at: "2025-01-01T00:00:00.000Z",
      reserve_in_usd: String(reserve),
      volume_usd: { h24: String(volume) },
      price_change_percentage: { h24: "5" },
      base_token_price_usd: baseToken.toLowerCase() === addressesFor("base").weth.toLowerCase() ? "4000" : "0.001",
      quote_token_price_usd: "4000",
    },
    relationships: {
      base_token: { data: { id: `base_${baseToken.toLowerCase()}` } },
      quote_token: { data: { id: `base_${quoteToken.toLowerCase()}` } },
      dex: { data: { id: dex } },
    },
  };
}
