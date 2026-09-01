import { describe, expect, it } from "vitest";
import { planCentralizedCatalogUpdate, type CuratorResearchDecision } from "../src/curator/catalog-update.js";
import { getCuratorConfig } from "../src/curator/config.js";
import type { MarketEvaluation } from "../src/curator/policy.js";
import type { CuratorReport } from "../src/curator/run.js";
import { getMarketCatalog, parseMarketCatalog } from "../src/markets/catalog.js";

function firstActiveMarket(chainSlug: "base" | "robinhood", catalog = getMarketCatalog()): { id: string; symbol: string } {
  const chain = catalog.chains.find((row) => row.slug === chainSlug)!;
  const market = chain.markets
    .filter((row) => row.status === "active")
    .sort((a, b) => a.id.localeCompare(b.id))[0]!;
  return { id: market.id, symbol: market.symbol };
}

const sources = [
  { url: "https://www.geckoterminal.com/robinhood/pools/example", title: "Pool", finding: "Pool identity and liquidity" },
  { url: "https://robinhoodchain.blockscout.com/token/example", title: "Contract", finding: "Verified token address" },
  { url: "https://example.com/project", title: "Project", finding: "Official project identity" },
];

describe("agentic centralized curator", () => {
  it("promotes identity research without allowing the agent to bypass market policy", () => {
    const config = structuredClone(getCuratorConfig());
    const candidate = config.candidates.find((row) => row.id === "robinhood-gg")!;
    candidate.identity = "watch";
    const result = planCentralizedCatalogUpdate({
      report: report([evaluation(candidate.id, "observe", false)]),
      decision: decision({ candidateReviews: [{ candidateId: candidate.id, identity: "reviewed", rationale: ["identity matched"], sources }] }),
      curatorConfig: config,
      catalog: structuredClone(getMarketCatalog()),
      today: "2026-08-30",
    });
    expect(result.appliedReviews).toEqual(["robinhood-gg:reviewed"]);
    expect(result.curatorConfig.version).toBe(config.version + 1);
    expect(result.appliedReplacement).toBeNull();
    expect(result.catalog).toEqual(getMarketCatalog());
  });

  it("applies only the exact deterministic Robinhood replacement", () => {
    const config = structuredClone(getCuratorConfig());
    const candidate = config.candidates.find((row) => row.id === "robinhood-gg")!;
    candidate.identity = "reviewed";
    const incumbent = firstActiveMarket("robinhood");
    const proposal = {
      chain: "robinhood" as const,
      candidateMarketId: candidate.id,
      candidateSymbol: candidate.symbol,
      incumbentMarketId: incumbent.id,
      incumbentSymbol: incumbent.symbol,
      candidateFeeAprPct: 900,
      incumbentFeeAprPct: 100,
      aprMultiple: 9,
    };
    const result = planCentralizedCatalogUpdate({
      report: { ...report([evaluation(candidate.id, "eligible", false)]), replacements: [proposal] },
      decision: decision({
        verdict: "replace",
        replacement: { fromMarketId: proposal.incumbentMarketId, toMarketId: proposal.candidateMarketId, rationale: ["policy proposal survived research"] },
      }),
      curatorConfig: config,
      catalog: structuredClone(getMarketCatalog()),
      today: "2026-08-30",
    });
    const parsed = parseMarketCatalog(result.catalog);
    const robinhood = parsed.chains.find((chain) => chain.slug === "robinhood")!;
    const outgoing = robinhood.markets.find((market) => market.id === proposal.incumbentMarketId)!;
    const incoming = robinhood.markets.find((market) => market.id === proposal.candidateMarketId)!;
    expect(outgoing.status).toBe("paused");
    expect(incoming.status).toBe("active");
    expect(incoming).not.toHaveProperty("weightBps");
    expect(incoming.rangeWidthPct).toBe(outgoing.rangeWidthPct);
    expect(result.appliedReplacement).toEqual({ fromMarketId: outgoing.id, toMarketId: incoming.id });
  });

  it("applies an exact deterministic Base Aerodrome replacement", () => {
    const config = structuredClone(getCuratorConfig());
    const candidate = {
      id: "base-test-meme",
      name: "Base Test Meme",
      symbol: "BTM",
      feePips: 2_111,
      risk: "emerging" as const,
      identity: "reviewed" as const,
      chain: "base" as const,
      token: "0x1111111111111111111111111111111111111111" as const,
      pool: "0x2222222222222222222222222222222222222222" as const,
      protocol: "AERODROME_SLIPSTREAM" as const,
      aerodromeDeployment: "legacy" as const,
      tickSpacing: 200,
    };
    config.candidates.push(candidate);
    const incumbent = firstActiveMarket("base");
    const proposal = {
      chain: "base" as const,
      candidateMarketId: candidate.id,
      candidateSymbol: candidate.symbol,
      incumbentMarketId: incumbent.id,
      incumbentSymbol: incumbent.symbol,
      candidateFeeAprPct: 450,
      incumbentFeeAprPct: 100,
      aprMultiple: 4.5,
    };
    const result = planCentralizedCatalogUpdate({
      report: { ...report([evaluation(candidate.id, "eligible", false, "base")]), replacements: [proposal] },
      decision: decision({
        verdict: "replace",
        replacement: { fromMarketId: incumbent.id, toMarketId: candidate.id, rationale: ["policy proposal survived research"] },
      }),
      curatorConfig: config,
      catalog: structuredClone(getMarketCatalog()),
      today: "2026-09-01",
    });
    const base = parseMarketCatalog(result.catalog).chains.find((chain) => chain.slug === "base")!;
    expect(base.markets.find((market) => market.id === incumbent.id)!.status).toBe("paused");
    expect(base.markets.find((market) => market.id === candidate.id)).toMatchObject({
      status: "active",
      protocol: "AERODROME_SLIPSTREAM",
      aerodromeDeployment: "legacy",
      pool: candidate.pool,
    });
    expect(result.appliedReplacement).toEqual({ fromMarketId: incumbent.id, toMarketId: candidate.id });
  });

  it("accepts Base explorer evidence for a reviewed Base candidate", () => {
    const config = structuredClone(getCuratorConfig());
    const candidate = {
      id: "base-researched-meme",
      name: "Base Researched Meme",
      symbol: "BRM",
      feePips: 3_000,
      risk: "experimental" as const,
      identity: "watch" as const,
      chain: "base" as const,
      token: "0x3333333333333333333333333333333333333333" as const,
      pool: "0x4444444444444444444444444444444444444444" as const,
      protocol: "V3" as const,
    };
    config.candidates.push(candidate);
    const baseSources = [
      { url: "https://www.geckoterminal.com/base/pools/example", title: "Pool", finding: "Pool identity and liquidity" },
      { url: "https://basescan.org/token/example", title: "Contract", finding: "Verified token address" },
      { url: "https://example.com/project", title: "Project", finding: "Official project identity" },
    ];
    const result = planCentralizedCatalogUpdate({
      report: report([evaluation(candidate.id, "observe", false, "base")]),
      decision: decision({ candidateReviews: [{ candidateId: candidate.id, identity: "reviewed", rationale: ["identity matched"], sources: baseSources }] }),
      curatorConfig: config,
      catalog: structuredClone(getMarketCatalog()),
      today: "2026-09-01",
    });
    expect(result.appliedReviews).toEqual([`${candidate.id}:reviewed`]);
  });

  it("pauses an incumbent the deterministic report calls pause", () => {
    const config = structuredClone(getCuratorConfig());
    const incumbent = firstActiveMarket("robinhood");
    const pauseEvaluation = {
      ...evaluation(incumbent.id, "pause", true),
      reasons: ["pool liquidity fell 64% in 24h", "median pool liquidity is below $75,000"],
    };
    const result = planCentralizedCatalogUpdate({
      report: report([pauseEvaluation]),
      decision: decision(),
      curatorConfig: config,
      catalog: structuredClone(getMarketCatalog()),
      today: "2026-08-31",
    });
    expect(result.appliedPauses).toEqual([`${incumbent.id}:pool liquidity fell 64% in 24h; median pool liquidity is below $75,000`]);
    expect(result.changedFiles).toContain("src/config/markets.json");
    const parsed = parseMarketCatalog(result.catalog);
    const robinhood = parsed.chains.find((chain) => chain.slug === "robinhood")!;
    expect(robinhood.markets.find((market) => market.id === incumbent.id)!.status).toBe("paused");
    expect(robinhood.markets.filter((market) => market.status === "active")).not.toHaveLength(0);
    expect(result.catalog.version).toBe(getMarketCatalog().version + 1);
  });

  it("does not pause on a non-incumbent or non-pause call", () => {
    const config = structuredClone(getCuratorConfig());
    const incumbent = firstActiveMarket("robinhood");
    const result = planCentralizedCatalogUpdate({
      report: report([evaluation(incumbent.id, "review", true), evaluation("robinhood-gg", "pause", false)]),
      decision: decision(),
      curatorConfig: config,
      catalog: structuredClone(getMarketCatalog()),
      today: "2026-08-31",
    });
    expect(result.appliedPauses).toEqual([]);
    expect(result.changedFiles).toEqual([]);
  });

  it("rejects an agent replacement that the deterministic report did not authorize", () => {
    const config = structuredClone(getCuratorConfig());
    config.candidates.find((row) => row.id === "robinhood-gg")!.identity = "reviewed";
    expect(() => planCentralizedCatalogUpdate({
      report: report([evaluation("robinhood-gg", "eligible", false)]),
      decision: decision({
        verdict: "replace",
        replacement: { fromMarketId: firstActiveMarket("robinhood").id, toMarketId: "robinhood-gg", rationale: ["unsupported"] },
      }),
      curatorConfig: config,
      catalog: structuredClone(getMarketCatalog()),
      today: "2026-08-30",
    })).toThrow(/not authorized/);
  });
});

function report(evaluations: MarketEvaluation[]): CuratorReport {
  return {
    version: 1,
    role: "curator",
    generatedAt: "2026-08-30T18:00:00.000Z",
    configVersion: getCuratorConfig().version,
    snapshotCadenceMinutes: 360,
    evaluations,
    replacements: [],
  };
}

function evaluation(
  marketId: string,
  recommendation: MarketEvaluation["recommendation"],
  incumbent: boolean,
  chain: MarketEvaluation["chain"] = "robinhood",
): MarketEvaluation {
  return {
    marketId,
    chain,
    symbol: marketId,
    risk: "experimental",
    incumbent,
    recommendation,
    estimatedCapacityUsd: 10_000,
    reasons: ["test"],
    summary: {
      marketId,
      observations: 30,
      historyHours: 200,
      observationCoveragePct: 100,
      medianLiquidityUsd: 1_000_000,
      minimumLiquidityUsd: 900_000,
      liquidityDrop24hPct: 0,
      medianVolume24hUsd: 500_000,
      medianFeeAprPct: 900,
      p90AbsPriceChange24hPct: 10,
      latestMarketCapUsd: 10_000_000,
      latestPoolAgeDays: 40,
      latestHolderCount: 2_000,
      latestTopHolderPct: 10,
      latestSocialLinks: 2,
      latestSecurityAvailable: true,
      identity: "reviewed",
      securityFlags: [],
    },
  };
}

function decision(overrides: Partial<CuratorResearchDecision> = {}): CuratorResearchDecision {
  return {
    schemaVersion: 1,
    verdict: "no_change",
    summary: "No policy-authorized replacement",
    candidateReviews: [],
    replacement: null,
    ...overrides,
  };
}
