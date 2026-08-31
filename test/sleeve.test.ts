import { describe, expect, it } from "vitest";
import { planCentralizedCatalogUpdate, type CuratorResearchDecision } from "../src/curator/catalog-update.js";
import { getCuratorConfig } from "../src/curator/config.js";
import type { CuratorReport } from "../src/curator/run.js";
import { getMarketCatalog, parseMarketCatalog, type MarketCatalog } from "../src/markets/catalog.js";
import { sleeveAwareWeights } from "../src/portfolio/allocation.js";
import { getRobinhoodIndexBreadthPolicy } from "../src/portfolio/index-selection.js";

const SLEEVE_TOKEN = "0x00000000000000000000000000000000000wizzy".replace("wizzy", "a0001");

function sleeveMarket(overrides: Partial<Record<string, unknown>> = {}) {
  const template = getMarketCatalog().chains.find((chain) => chain.slug === "robinhood")!.markets.find((market) => market.status === "active" && !market.sleeve)!;
  return {
    ...structuredClone(template),
    id: "robinhood-wizzy",
    name: "Wizzy",
    symbol: "WIZZY",
    token: SLEEVE_TOKEN,
    pool: "0x00000000000000000000000000000000000b0001",
    weightBps: 500,
    sleeve: true,
    risk: "experimental" as const,
    ...overrides,
  };
}

function catalogWithSleeve(overrides: Partial<Record<string, unknown>> = {}): MarketCatalog {
  const catalog = structuredClone(getMarketCatalog());
  const robinhood = catalog.chains.find((chain) => chain.slug === "robinhood")!;
  robinhood.markets = robinhood.markets.filter((market) => !market.sleeve);
  const actives = robinhood.markets.filter((market) => market.status === "active");
  // rescale ordinaries to 9,500 so the active total stays 10,000
  let remaining = 9_500;
  const total = actives.reduce((sum, market) => sum + market.weightBps, 0);
  actives.forEach((market, index) => {
    if (index === actives.length - 1) {
      market.weightBps = remaining;
      return;
    }
    market.weightBps = Math.floor((market.weightBps * 9_500) / total);
    remaining -= market.weightBps;
  });
  robinhood.markets.push(sleeveMarket(overrides) as never);
  return catalog;
}

describe("related-party sleeve", () => {
  it("keeps the sleeve at exactly its share on every breadth tier", () => {
    expect(sleeveAwareWeights([
      { weightBps: 500, sleeve: true },
      { weightBps: 3_700 },
    ])).toEqual([500, 9_500]);
    expect(sleeveAwareWeights([
      { weightBps: 3_700 },
      { weightBps: 500, sleeve: true },
      { weightBps: 2_300 },
    ])).toEqual([5_858, 500, 3_642]);
    // full tier is the identity: ordinaries already sum to 9,500
    expect(sleeveAwareWeights([
      { weightBps: 500, sleeve: true },
      { weightBps: 5_000 },
      { weightBps: 4_500 },
    ])).toEqual([500, 5_000, 4_500]);
    // no sleeve selected: untouched
    expect(sleeveAwareWeights([{ weightBps: 7_000 }, { weightBps: 3_000 }])).toEqual([7_000, 3_000]);
  });

  it("includes the sleeve in every Robinhood breadth tier", () => {
    const policy = getRobinhoodIndexBreadthPolicy([
      { id: "robinhood-a", weightBps: 6_000 },
      { id: "robinhood-wizzy", weightBps: 500, sleeve: true },
      { id: "robinhood-b", weightBps: 3_500 },
    ]);
    expect(policy.maximumConstituents).toBe(3);
    expect(policy.tiers.map((tier) => tier.constituentCount)).toEqual([2, 3]);
    for (const tier of policy.tiers) {
      expect(tier.marketIds).toContain("robinhood-wizzy");
    }
    expect(policy.tiers[0]!.marketIds).toEqual(["robinhood-a", "robinhood-wizzy"]);
  });

  it("parses a valid sleeve catalog and rejects invalid sleeve shapes", () => {
    const valid = catalogWithSleeve();
    expect(() => parseMarketCatalog(valid)).not.toThrow();
    expect(() => parseMarketCatalog(catalogWithSleeve({ weightBps: 1_500 }))).toThrow();
    const twoSleeves = catalogWithSleeve();
    twoSleeves.chains.find((chain) => chain.slug === "robinhood")!.markets.push(
      sleeveMarket({ id: "robinhood-wizzy-2", weightBps: 500, status: "watch" }) as never,
    );
    expect(() => parseMarketCatalog(twoSleeves)).toThrow(/one related-party sleeve/);
  });

  it("blocks the curator from touching the sleeve", () => {
    const catalog = parseMarketCatalog(catalogWithSleeve());
    const config = structuredClone(getCuratorConfig());
    config.candidates[0]!.token = SLEEVE_TOKEN;
    expect(() => planCentralizedCatalogUpdate({
      report: report(),
      decision: decision(),
      curatorConfig: config,
      catalog,
      today: "2026-09-01",
    })).toThrow(/never ranks or selects/);
  });
});

function report(): CuratorReport {
  return {
    version: 1,
    role: "curator",
    generatedAt: "2026-09-01T12:00:00.000Z",
    configVersion: getCuratorConfig().version,
    snapshotCadenceMinutes: 360,
    evaluations: [],
    replacements: [],
  };
}

function decision(): CuratorResearchDecision {
  return { schemaVersion: 1, verdict: "no_change", summary: "test", candidateReviews: [], replacement: null };
}
