import { describe, expect, it } from "vitest";
import type { CuratorReport } from "../src/curator/run.js";
import { planAutonomousRobinhoodRegistry } from "../src/index/autonomous.js";
import { initialRobinhoodRegistryMarkets } from "../src/index/publish.js";
import type { RegistryMarket } from "../src/index/registry.js";

function report(overrides: Partial<CuratorReport> = {}): CuratorReport {
  const generatedAt = "2026-08-30T12:00:00.000Z";
  const evaluations = initialRobinhoodRegistryMarkets().map((market) => {
    const id = Buffer.from(market.id.slice(2), "hex").toString("utf8").replace(/\0+$/g, "");
    return {
      marketId: id,
      chain: "robinhood" as const,
      symbol: id.toUpperCase(),
      risk: "emerging" as const,
      incumbent: true,
      recommendation: "hold" as const,
      estimatedCapacityUsd: 1_000,
      reasons: ["all maintained-market gates pass"],
      summary: {
        marketId: id,
        observations: 8,
        historyHours: 48,
        observationCoveragePct: 100,
        medianLiquidityUsd: 100_000,
        minimumLiquidityUsd: 100_000,
        liquidityDrop24hPct: 0,
        medianVolume24hUsd: 100_000,
        medianFeeAprPct: 100,
        p90AbsPriceChange24hPct: 5,
        latestMarketCapUsd: 1_000_000,
        latestPoolAgeDays: 40,
        latestHolderCount: 1_000,
        latestTopHolderPct: 5,
        latestSocialLinks: 2,
        latestSecurityAvailable: true,
        identity: "reviewed" as const,
        securityFlags: [],
      },
    };
  });
  return {
    version: 1,
    role: "curator",
    generatedAt,
    configVersion: 3,
    snapshotCadenceMinutes: 360,
    evaluations,
    replacements: [],
    ...overrides,
  };
}

function currentMarkets(): RegistryMarket[] {
  return initialRobinhoodRegistryMarkets().map((market) => ({
    id: Buffer.from(market.id.slice(2), "hex").toString("utf8").replace(/\0+$/g, ""),
    token: market.token,
    pool: market.pool,
    weightBps: market.weightBps,
    fee: market.fee,
    tickSpacing: market.tickSpacing,
    rangeWidthBps: market.rangeWidthBps,
  }));
}

const now = new Date("2026-08-30T12:30:00.000Z");

describe("autonomous Robinhood registry", () => {
  it("initializes the reviewed launch snapshot without requiring every incumbent to be hold", () => {
    const input = report();
    input.evaluations.at(-1)!.recommendation = "review";
    const plan = planAutonomousRobinhoodRegistry({ report: input, now });
    expect(plan.kind).toBe("publish");
  });

  it("does nothing when the onchain snapshot already matches and a market is under review", () => {
    const input = report();
    input.evaluations.at(-1)!.recommendation = "review";
    const plan = planAutonomousRobinhoodRegistry({ report: input, currentMarkets: currentMarkets(), now });
    expect(plan).toMatchObject({ kind: "noop" });
  });

  it("pauses the whole registry on a hard incumbent failure", () => {
    const input = report();
    input.evaluations[0]!.recommendation = "pause";
    input.evaluations[0]!.reasons = ["security: malicious transfer behavior"];
    const plan = planAutonomousRobinhoodRegistry({ report: input, currentMarkets: currentMarkets(), now });
    expect(plan).toMatchObject({ kind: "pause" });
  });

  it("replaces a reviewed incumbent only with an eligible configured candidate", () => {
    const input = report();
    const incumbent = input.evaluations.at(-1)!;
    incumbent.recommendation = "review";
    input.evaluations.push({
      ...incumbent,
      marketId: "robinhood-gg",
      symbol: "GG",
      incumbent: false,
      recommendation: "eligible",
    });
    input.replacements = [{
      chain: "robinhood",
      candidateMarketId: "robinhood-gg",
      candidateSymbol: "GG",
      incumbentMarketId: incumbent.marketId,
      incumbentSymbol: incumbent.symbol,
      candidateFeeAprPct: 200,
      incumbentFeeAprPct: 100,
      aprMultiple: 2,
    }];
    const plan = planAutonomousRobinhoodRegistry({ report: input, currentMarkets: currentMarkets(), now });
    expect(plan.kind).toBe("publish");
    if (plan.kind !== "publish") return;
    expect(plan.markets.some((market) => Buffer.from(market.id.slice(2), "hex").toString("utf8").startsWith("robinhood-gg"))).toBe(true);
    expect(plan.markets.reduce((sum, market) => sum + market.weightBps, 0)).toBe(10_000);
  });

  it("refuses stale evidence", () => {
    expect(() => planAutonomousRobinhoodRegistry({
      report: report({ generatedAt: "2026-08-29T12:00:00.000Z" }),
      currentMarkets: currentMarkets(),
      now,
    })).toThrow("stale");
  });
});
