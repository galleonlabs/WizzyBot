import { describe, expect, it } from "vitest";
import { getCuratorConfig } from "../src/curator/config.js";
import { extractCuratorDiscoveries, type GeckoPoolsPayload } from "../src/curator/discovery.js";

const observedAt = "2026-09-01T12:00:00.000Z";

describe("curator discovery", () => {
  it("emits only mature, liquid WETH pools on supported Uniswap versions that are not already tracked", () => {
    const payload = poolsPayload([
      pool("0x1111111111111111111111111111111111111111", "MEME / WETH 1%", "0x2222222222222222222222222222222222222222", "2026-01-01T00:00:00.000Z", 900_000, 300_000, "uniswap-v3-base"),
      pool("0x3333333333333333333333333333333333333333", "YOUNG / WETH 1%", "0x4444444444444444444444444444444444444444", "2026-08-20T00:00:00.000Z", 900_000, 300_000, "uniswap-v3-base"),
      pool("0x5555555555555555555555555555555555555555", "OTHER / WETH 1%", "0x6666666666666666666666666666666666666666", "2026-01-01T00:00:00.000Z", 900_000, 300_000, "aerodrome-base"),
    ]);
    const discoveries = extractCuratorDiscoveries([payload], "base", {
      policy: getCuratorConfig().policy,
      existingTokens: new Set(),
      existingPools: new Set(),
      observedAt,
    });
    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]).toMatchObject({
      chain: "base",
      symbol: "MEME",
      protocol: "V3",
      feePips: 10_000,
      dexId: "uniswap-v3-base",
    });
  });

  it("deduplicates the same pool across feeds and keeps its strongest observation", () => {
    const token = "0x2222222222222222222222222222222222222222";
    const shallow = poolsPayload([pool("0x7777777777777777777777777777777777777777", "MEME / WETH 1%", token, "2026-01-01T00:00:00.000Z", 300_000, 100_000, "uniswap-v3-base")]);
    const deep = poolsPayload([pool("0x7777777777777777777777777777777777777777", "MEME / WETH 1%", token, "2026-01-01T00:00:00.000Z", 1_200_000, 500_000, "uniswap-v3-base")]);
    const discoveries = extractCuratorDiscoveries([shallow, deep], "base", {
      policy: getCuratorConfig().policy,
      existingTokens: new Set(),
      existingPools: new Set(),
      observedAt,
    });
    expect(discoveries).toHaveLength(1);
    expect(discoveries[0]).toMatchObject({ pool: "0x7777777777777777777777777777777777777777", feePips: 10_000 });
    expect(discoveries[0]?.venues).toHaveLength(1);
  });

  it("aggregates V2 and V3 depth for the same meme while retaining an executable V3 primary", () => {
    const token = "0x2222222222222222222222222222222222222222";
    const payload = poolsPayload([
      pool("0x1111111111111111111111111111111111111111", "MEME / WETH", token, "2026-01-01T00:00:00.000Z", 150_000, 30_000, "uniswap-v2-base"),
      pool("0x3333333333333333333333333333333333333333", "MEME / WETH 1%", token, "2026-01-01T00:00:00.000Z", 100_000, 30_000, "uniswap-v3-base"),
    ]);
    const [discovery] = extractCuratorDiscoveries([payload], "base", {
      policy: getCuratorConfig().policy,
      existingTokens: new Set(),
      existingPools: new Set(),
      observedAt,
    });
    expect(discovery).toMatchObject({
      protocol: "V3",
      executionReady: true,
      liquidityUsd: 250_000,
      volume24hUsd: 60_000,
    });
    expect(discovery?.venues.map((venue) => venue.protocol).sort()).toEqual(["V2", "V3"]);
  });

  it("keeps a qualifying V4-only meme visible as research-only until its pool key is verified", () => {
    const poolId = `0x${"a".repeat(64)}`;
    const payload = poolsPayload([
      pool(poolId, "MEME / WETH 0.3%", "0x2222222222222222222222222222222222222222", "2026-01-01T00:00:00.000Z", 400_000, 90_000, "uniswap-v4-base"),
    ]);
    const [discovery] = extractCuratorDiscoveries([payload], "base", {
      policy: getCuratorConfig().policy,
      existingTokens: new Set(),
      existingPools: new Set(),
      observedAt,
    });
    expect(discovery).toMatchObject({ protocol: "V4", pool: poolId, executionReady: false });
    expect(discovery?.executionNote).toContain("supported V3 primary pool");
    expect(discovery?.venues[0]).toMatchObject({ protocol: "V4", autoAttachable: false });
  });

  it("surfaces a new V2 pool for an already tracked meme as an attachable venue lead", () => {
    const token = "0x2222222222222222222222222222222222222222";
    const v4PoolId = `0x${"b".repeat(64)}`;
    const payload = poolsPayload([
      pool("0x1111111111111111111111111111111111111111", "MEME / WETH", token, "2026-01-01T00:00:00.000Z", 400_000, 90_000, "uniswap-v2-base"),
      pool(v4PoolId, "MEME / WETH 0.3%", token, "2026-01-01T00:00:00.000Z", 800_000, 120_000, "uniswap-v4-base"),
    ]);
    const [discovery] = extractCuratorDiscoveries([payload], "base", {
      policy: getCuratorConfig().policy,
      existingTokens: new Set(),
      existingPools: new Set(),
      trackedMarkets: new Map([[token, "base-meme"]]),
      observedAt,
    });
    expect(discovery).toMatchObject({
      kind: "venue",
      marketId: "base-meme",
      protocol: "V2",
      executionReady: true,
    });
    expect(discovery?.venues.map((venue) => venue.protocol).sort()).toEqual(["V2", "V4"]);
  });
});

function pool(
  address: string,
  name: string,
  token: string,
  createdAt: string,
  liquidity: number,
  volume: number,
  dex: string,
) {
  return {
    attributes: {
      address,
      name,
      pool_created_at: createdAt,
      reserve_in_usd: String(liquidity),
      volume_usd: { h24: String(volume) },
    },
    relationships: {
      base_token: { data: { id: `base_${token}` } },
      quote_token: { data: { id: "base_0x4200000000000000000000000000000000000006" } },
      dex: { data: { id: dex } },
    },
  };
}

function poolsPayload(data: ReturnType<typeof pool>[]): GeckoPoolsPayload {
  return {
    data,
    included: [...new Set(data.map((row) => row.relationships.base_token.data.id))].map((id) => ({
      id,
      type: "token" as const,
      attributes: { address: id.slice(id.indexOf("_") + 1), name: "Meme", symbol: "MEME", decimals: 18 },
    })),
  };
}
