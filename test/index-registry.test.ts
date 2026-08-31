import { getAddress, stringToHex, type PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { addressesFor } from "../src/chains.js";
import { getCuratorConfig } from "../src/curator/config.js";
import { activeMarkets } from "../src/markets/catalog.js";
import { encodeRegistryPublish, initialRobinhoodRegistryMarkets } from "../src/index/publish.js";
import { catalogWithRegistryMarkets, readIndexRegistry, resolveRegistryMarkets, type IndexRegistrySnapshot } from "../src/index/registry.js";

function snapshot(overrides: Partial<IndexRegistrySnapshot> = {}): IndexRegistrySnapshot {
  const addresses = addressesFor("robinhood");
  return {
    address: "0x0000000000000000000000000000000000000001",
    blockNumber: 1n,
    version: 1,
    updatedAt: 1_788_091_200,
    paused: false,
    evidenceHash: `0x${"11".repeat(32)}`,
    evidenceURI: "ipfs://curator-report",
    factory: addresses.factory,
    quoteToken: addresses.weth,
    markets: activeMarkets("robinhood").map((market) => ({
      id: market.id,
      token: market.token,
      pool: market.pool,
      weightBps: market.weightBps,
      fee: market.fee,
      tickSpacing: market.tickSpacing,
      rangeWidthBps: Math.round(market.rangeWidthPct * 100),
    })),
    replacements: [],
    ...overrides,
  };
}

describe("onchain Una index registry", () => {
  it("resolves trust-critical registry fields against reviewed display metadata", () => {
    const resolved = resolveRegistryMarkets(snapshot());
    expect(resolved).toHaveLength(activeMarkets("robinhood").length);
    expect(resolved.reduce((sum, market) => sum + market.weightBps, 0)).toBe(10_000);
    expect(resolved.every((market) => market.status === "active" && market.protocol === "V3")).toBe(true);
  });

  it("fails closed when the registry is paused or bound to the wrong factory", () => {
    expect(() => resolveRegistryMarkets(snapshot({ paused: true }))).toThrow("paused");
    expect(() => resolveRegistryMarkets(snapshot({ factory: "0x0000000000000000000000000000000000000002" }))).toThrow("unexpected factory");
  });

  it("fails closed on unknown or conflicting membership", () => {
    const unknown = snapshot();
    unknown.markets[0] = { ...unknown.markets[0]!, id: "robinhood-unknown" };
    expect(() => resolveRegistryMarkets(unknown)).toThrow("unknown market");

    const conflict = snapshot();
    conflict.markets[0] = { ...conflict.markets[0]!, pool: "0x0000000000000000000000000000000000000003" };
    expect(() => resolveRegistryMarkets(conflict)).toThrow("conflicts with reviewed metadata");
  });

  it("encodes the reviewed launch snapshot as one publish call", () => {
    const markets = initialRobinhoodRegistryMarkets();
    expect(markets).toHaveLength(activeMarkets("robinhood").length);
    expect(markets.reduce((sum, market) => sum + market.weightBps, 0)).toBe(10_000);
    const data = encodeRegistryPublish({ expectedVersion: 0n, evidenceHash: `0x${"22".repeat(32)}` });
    expect(data).toMatch(/^0x1198b2ff/);
  });

  it("derives a user migration directly from an onchain curator replacement", () => {
    const next = snapshot({ version: 2, updatedAt: 1_788_115_200 });
    const outgoing = next.markets.at(-1)!;
    const candidate = getCuratorConfig().candidates.find((row) => row.id === "robinhood-gg")!;
    next.markets[next.markets.length - 1] = {
      ...outgoing,
      id: candidate.id,
      token: getAddress(candidate.token),
      pool: getAddress(candidate.pool),
      fee: candidate.feePips,
      tickSpacing: 200,
    };
    next.replacements = [{ fromMarketId: outgoing.id, toMarketId: candidate.id }];

    const current = resolveRegistryMarkets(next);
    const catalog = catalogWithRegistryMarkets(current, next.version, next.updatedAt, next.replacements);
    expect(catalog.migrations).toContainEqual(expect.objectContaining({
      fromMarketId: outgoing.id,
      toMarketId: candidate.id,
    }));
    const robinhood = catalog.chains.find((chain) => chain.slug === "robinhood")!;
    expect(robinhood.markets.find((market) => market.id === outgoing.id)?.status).toBe("paused");
    expect(robinhood.markets.find((market) => market.id === candidate.id)?.status).toBe("active");
  });

  it("reads every registry field from one block", async () => {
    const addresses = addressesFor("robinhood");
    const calls: Array<{ functionName: string; blockNumber: bigint }> = [];
    const values: Record<string, unknown> = {
      version: 4n,
      updatedAt: 1_788_091_200n,
      paused: false,
      evidenceHash: `0x${"33".repeat(32)}`,
      evidenceURI: "ipfs://report-v4",
      FACTORY: addresses.factory,
      QUOTE_TOKEN: addresses.weth,
      getMarkets: activeMarkets("robinhood").map((market) => ({
        id: stringToHex(market.id, { size: 32 }),
        token: market.token,
        pool: market.pool,
        weightBps: BigInt(market.weightBps),
        fee: BigInt(market.fee),
        tickSpacing: BigInt(market.tickSpacing),
        rangeWidthBps: BigInt(Math.round(market.rangeWidthPct * 100)),
      })),
    };
    const client = {
      getBlockNumber: async () => 123n,
      readContract: async ({ functionName, blockNumber }: { functionName: string; blockNumber: bigint }) => {
        calls.push({ functionName, blockNumber });
        return functionName === "replacementOf" ? `0x${"00".repeat(32)}` : values[functionName];
      },
    } as unknown as PublicClient;
    const result = await readIndexRegistry(client, "0x0000000000000000000000000000000000000001");
    expect(result.version).toBe(4);
    expect(result.markets).toHaveLength(activeMarkets("robinhood").length);
    expect(calls.length).toBeGreaterThan(8);
    expect(calls.every((call) => call.blockNumber === 123n)).toBe(true);
  });
});
