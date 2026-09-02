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
    expect(result.appliedAdmissions).toEqual([]);
    expect(result.catalog).toEqual(getMarketCatalog());
  });

  it("adds an exact deterministic Robinhood admission without pausing another market", () => {
    const config = structuredClone(getCuratorConfig());
    const candidate = config.candidates.find((row) => row.id === "robinhood-gg")!;
    candidate.identity = "reviewed";
    const before = structuredClone(getMarketCatalog());
    const proposal = {
      chain: "robinhood" as const,
      candidateMarketId: candidate.id,
      candidateSymbol: candidate.symbol,
      qualityScore: 90,
      estimatedCapacityUsd: 10_000,
    };
    const result = planCentralizedCatalogUpdate({
      report: { ...report([evaluation(candidate.id, "eligible", false)]), admissions: [proposal] },
      decision: decision({
        verdict: "update",
        marketAdmissions: [{ candidateMarketId: proposal.candidateMarketId, rationale: ["policy proposal survived research"] }],
      }),
      curatorConfig: config,
      catalog: before,
      today: "2026-08-30",
    });
    const parsed = parseMarketCatalog(result.catalog);
    const robinhood = parsed.chains.find((chain) => chain.slug === "robinhood")!;
    const incoming = robinhood.markets.find((market) => market.id === proposal.candidateMarketId)!;
    expect(incoming.status).toBe("active");
    expect(incoming).not.toHaveProperty("weightBps");
    expect(robinhood.markets.filter((market) => market.status === "active")).toHaveLength(
      getMarketCatalog().chains.find((chain) => chain.slug === "robinhood")!.markets.filter((market) => market.status === "active").length + 1,
    );
    expect(result.appliedAdmissions).toEqual([candidate.id]);
  });

  it("admits an independently eligible Base Aerodrome market", () => {
    const config = structuredClone(getCuratorConfig());
    const candidate = {
      id: "base-test-meme",
      name: "Base Test Meme",
      symbol: "BTM",
      feePips: 2_111,
      risk: "emerging" as const,
      identity: "reviewed" as const,
      tokenDecimals: 18,
      chain: "base" as const,
      token: "0x1111111111111111111111111111111111111111" as const,
      pool: "0x2222222222222222222222222222222222222222" as const,
      protocol: "AERODROME_SLIPSTREAM" as const,
      aerodromeDeployment: "legacy" as const,
      tickSpacing: 200,
    };
    config.candidates.push(candidate);
    const proposal = {
      chain: "base" as const,
      candidateMarketId: candidate.id,
      candidateSymbol: candidate.symbol,
      qualityScore: 90,
      estimatedCapacityUsd: 10_000,
    };
    const result = planCentralizedCatalogUpdate({
      report: { ...report([evaluation(candidate.id, "eligible", false, "base")]), admissions: [proposal] },
      decision: decision({
        verdict: "update",
        marketAdmissions: [{ candidateMarketId: candidate.id, rationale: ["policy proposal survived research"] }],
      }),
      curatorConfig: config,
      catalog: structuredClone(getMarketCatalog()),
      today: "2026-09-01",
    });
    const base = parseMarketCatalog(result.catalog).chains.find((chain) => chain.slug === "base")!;
    expect(base.markets.find((market) => market.id === candidate.id)).toMatchObject({
      status: "active",
      protocol: "AERODROME_SLIPSTREAM",
      aerodromeDeployment: "legacy",
      pool: candidate.pool,
    });
    expect(result.appliedAdmissions).toEqual([candidate.id]);
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
      tokenDecimals: 18,
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

  it("adds a researched discovery to the watch registry without activating it", () => {
    const config = structuredClone(getCuratorConfig());
    const discovery = {
      id: "base-fresh-555555",
      kind: "candidate" as const,
      chain: "base" as const,
      name: "Fresh Meme",
      symbol: "FRESH",
      token: "0x5555555555555555555555555555555555555555" as const,
      tokenDecimals: 18,
      pool: "0x6666666666666666666666666666666666666666" as const,
      protocol: "V3" as const,
      feePips: 10_000,
      liquidityUsd: 900_000,
      volume24hUsd: 400_000,
      poolAgeDays: 90,
      sourceUrl: "https://www.geckoterminal.com/base/pools/0x6666666666666666666666666666666666666666",
      dexId: "uniswap-v3-base",
      executionReady: true,
      policyEligible: true,
      eligibilityNotes: [],
      venues: [
        {
          protocol: "V3" as const,
          pool: "0x6666666666666666666666666666666666666666" as const,
          feePips: 10_000,
          liquidityUsd: 700_000,
          volume24hUsd: 300_000,
          poolAgeDays: 90,
          sourceUrl: "https://www.geckoterminal.com/base/pools/0x6666666666666666666666666666666666666666",
          dexId: "uniswap-v3-base",
          autoAttachable: true,
        },
        {
          protocol: "V2" as const,
          pool: "0x7777777777777777777777777777777777777777" as const,
          feePips: 3_000,
          liquidityUsd: 200_000,
          volume24hUsd: 100_000,
          poolAgeDays: 80,
          sourceUrl: "https://www.geckoterminal.com/base/pools/0x7777777777777777777777777777777777777777",
          dexId: "uniswap-v2-base",
          autoAttachable: true,
        },
      ],
    };
    const baseSources = [
      { url: discovery.sourceUrl, title: "Pool", finding: "Pool identity and live market data" },
      { url: `https://basescan.org/token/${discovery.token}`, title: "Contract", finding: "Token contract and source" },
      { url: "https://example.com/fresh", title: "Project", finding: "Project identity" },
    ];
    const inputReport = { ...report([]), discoveries: [discovery] };
    const result = planCentralizedCatalogUpdate({
      report: inputReport,
      decision: decision({
        candidateNominations: [{ discoveryId: discovery.id, identity: "watch", rationale: ["worth a proof window"], sources: baseSources }],
      }),
      curatorConfig: config,
      catalog: structuredClone(getMarketCatalog()),
      today: "2026-09-01",
    });
    expect(result.appliedNominations).toEqual([`${discovery.id}:watch`]);
    expect(result.curatorConfig.candidates.find((candidate) => candidate.id === discovery.id)).toMatchObject({
      identity: "watch",
      risk: "experimental",
      chain: "base",
      protocol: "V3",
      liquidityVenues: [{ protocol: "V2", pool: "0x7777777777777777777777777777777777777777" }],
      sources: baseSources.map((source) => source.url),
    });
    expect(result.catalog).toEqual(getMarketCatalog());
    expect(result.changedFiles).toEqual(["src/config/curator.json"]);
  });

  it("refuses a discovery nomination that was not emitted by the deterministic report", () => {
    expect(() => planCentralizedCatalogUpdate({
      report: report([]),
      decision: decision({
        candidateNominations: [{ discoveryId: "base-invented-token", identity: "watch", rationale: ["invented"], sources: [
          { url: "https://www.geckoterminal.com/base/pools/example", title: "Pool", finding: "Pool" },
          { url: "https://basescan.org/token/example", title: "Contract", finding: "Contract" },
          { url: "https://example.com/project", title: "Project", finding: "Project" },
        ] }],
      }),
      curatorConfig: structuredClone(getCuratorConfig()),
      catalog: structuredClone(getMarketCatalog()),
      today: "2026-09-01",
    })).toThrow("unknown discovery");
  });

  it("keeps a V4-only discovery in research instead of inventing executable pool-key data", () => {
    const poolId = `0x${"a".repeat(64)}` as `0x${string}`;
    const discovery = {
      id: "base-v4-lead-555555",
      kind: "candidate" as const,
      chain: "base" as const,
      name: "V4 Lead",
      symbol: "V4LEAD",
      token: "0x5555555555555555555555555555555555555555" as const,
      tokenDecimals: 18,
      pool: poolId,
      protocol: "V4" as const,
      feePips: 3_000,
      liquidityUsd: 500_000,
      volume24hUsd: 100_000,
      poolAgeDays: 60,
      sourceUrl: `https://www.geckoterminal.com/base/pools/${poolId}`,
      dexId: "uniswap-v4-base",
      executionReady: false,
      executionNote: "Pool key research is required.",
      policyEligible: true,
      eligibilityNotes: [],
      venues: [{
        protocol: "V4" as const,
        pool: poolId,
        feePips: 3_000,
        liquidityUsd: 500_000,
        volume24hUsd: 100_000,
        poolAgeDays: 60,
        sourceUrl: `https://www.geckoterminal.com/base/pools/${poolId}`,
        dexId: "uniswap-v4-base",
        autoAttachable: false,
      }],
    };
    expect(() => planCentralizedCatalogUpdate({
      report: { ...report([]), discoveries: [discovery] },
      decision: decision({
        candidateNominations: [{ discoveryId: discovery.id, identity: "watch", rationale: ["research further"], sources: [
          { url: discovery.sourceUrl, title: "Pool", finding: "Pool identity" },
          { url: `https://basescan.org/token/${discovery.token}`, title: "Contract", finding: "Token contract" },
          { url: "https://example.com/v4lead", title: "Project", finding: "Project identity" },
        ] }],
      }),
      curatorConfig: structuredClone(getCuratorConfig()),
      catalog: structuredClone(getMarketCatalog()),
      today: "2026-09-01",
    })).toThrow("research lead, not an executable V3 catalog candidate");
  });

  it("adds a researched V2 venue to an existing market without replacing the market", () => {
    const catalog = structuredClone(getMarketCatalog());
    const market = catalog.chains.find((chain) => chain.slug === "base")!.markets.find((entry) => entry.id === "base-basecat")!;
    const pool = "0x1111111111111111111111111111111111111111" as const;
    const discovery = {
      id: `base-basecat-${market.token.slice(2, 8).toLowerCase()}`,
      kind: "venue" as const,
      marketId: market.id,
      chain: "base" as const,
      name: market.name,
      symbol: market.symbol,
      token: market.token,
      tokenDecimals: market.tokenDecimals,
      pool,
      protocol: "V2" as const,
      feePips: 3_000,
      liquidityUsd: 500_000,
      volume24hUsd: 100_000,
      poolAgeDays: 60,
      sourceUrl: `https://www.geckoterminal.com/base/pools/${pool}`,
      dexId: "uniswap-v2-base",
      executionReady: true,
      policyEligible: true,
      eligibilityNotes: [],
      venues: [{
        protocol: "V2" as const,
        pool,
        feePips: 3_000,
        liquidityUsd: 500_000,
        volume24hUsd: 100_000,
        poolAgeDays: 60,
        sourceUrl: `https://www.geckoterminal.com/base/pools/${pool}`,
        dexId: "uniswap-v2-base",
        autoAttachable: true,
      }],
    };
    const baseSources = [
      { url: discovery.sourceUrl, title: "Pool", finding: "V2 pair and liquidity" },
      { url: `https://basescan.org/token/${market.token}`, title: "Contract", finding: "Tracked token contract" },
      { url: "https://example.com/basecat", title: "Project", finding: "Project identity" },
    ];
    const result = planCentralizedCatalogUpdate({
      report: { ...report([]), discoveries: [discovery] },
      decision: decision({ venueAdditions: [{ discoveryId: discovery.id, marketId: market.id, rationale: ["verified V2 route"], sources: baseSources }] }),
      curatorConfig: structuredClone(getCuratorConfig()),
      catalog,
      today: "2026-09-01",
    });
    expect(result.appliedVenues).toEqual([`${market.id}:V2:${pool}`]);
    expect(result.appliedAdmissions).toEqual([]);
    expect(result.changedFiles).toEqual(["src/config/markets.json"]);
    expect(result.catalog.version).toBe(getMarketCatalog().version + 1);
    expect(result.catalog.chains.find((chain) => chain.slug === "base")!.markets.find((entry) => entry.id === market.id)!.liquidityVenues).toContainEqual({ protocol: "V2", pool });
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

  it("rejects a market admission that the deterministic report did not authorize", () => {
    const config = structuredClone(getCuratorConfig());
    config.candidates.find((row) => row.id === "robinhood-gg")!.identity = "reviewed";
    expect(() => planCentralizedCatalogUpdate({
      report: report([evaluation("robinhood-gg", "eligible", false)]),
      decision: decision({
        verdict: "update",
        marketAdmissions: [{ candidateMarketId: "robinhood-gg", rationale: ["unsupported"] }],
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
    discoveries: [],
    admissions: [],
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
    quality: {
      score: 85,
      confidence: "high",
      depth: 25,
      flow: 20,
      durability: 20,
      resilience: 15,
      trust: 5,
    },
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
    schemaVersion: 2,
    verdict: "no_change",
    summary: "No policy-authorized update",
    candidateReviews: [],
    candidateNominations: [],
    venueAdditions: [],
    marketAdmissions: [],
    ...overrides,
  };
}
