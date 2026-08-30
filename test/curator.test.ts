import { describe, expect, it } from "vitest";
import { getCuratorConfig } from "../src/curator/config.js";
import { evaluateMarket, proposeReplacements, summarizeMarketHistory, type CuratorObservation } from "../src/curator/policy.js";
import { decodeSolanaMintSecurity } from "../src/curator/sources.js";

const policy = getCuratorConfig().policy;

function history(overrides: Partial<CuratorObservation> = {}, hours = 14 * 24): CuratorObservation[] {
  const start = Date.parse("2026-08-01T00:00:00.000Z");
  return Array.from({ length: hours + 1 }, (_, index): CuratorObservation => ({
    marketId: "base-example",
    chain: "base",
    name: "Example",
    symbol: "MEME",
    token: "0x0000000000000000000000000000000000000001",
    pool: "0x0000000000000000000000000000000000000002",
    protocol: "V3",
    incumbent: false,
    catalogStatus: "watch",
    risk: "established",
    identity: "reviewed",
    liquidityUsd: 1_000_000,
    volume24hUsd: 500_000,
    fees24hUsd: 5_000,
    feeAprPct: 182.5,
    priceUsd: 0.01,
    priceChange24hPct: 8,
    marketCapUsd: 50_000_000,
    poolAgeDays: 180 + index / 24,
    holderCount: 50_000,
    topHolderPct: 5,
    socialLinks: 3,
    securityAvailable: true,
    securityFlags: [],
    sourceUrl: "https://dexscreener.com/base/example",
    observedAt: new Date(start + index * 3_600_000).toISOString(),
    ...overrides,
  }));
}

describe("index curator", () => {
  it("reads Solana mint and freeze authority options without native bindings", () => {
    const immutableMint = new Uint8Array(82);
    expect(decodeSolanaMintSecurity(immutableMint)).toEqual({ mintAuthorityDisabled: true, freezeAuthorityDisabled: true });

    const mutableMint = new Uint8Array(82);
    const view = new DataView(mutableMint.buffer);
    view.setUint32(0, 1, true);
    view.setUint32(46, 1, true);
    expect(decodeSolanaMintSecurity(mutableMint)).toEqual({ mintAuthorityDisabled: false, freezeAuthorityDisabled: false });
    expect(decodeSolanaMintSecurity(new Uint8Array(81))).toBeNull();
  });

  it("requires a complete proof window before a candidate becomes eligible", () => {
    expect(evaluateMarket(history({}, 6 * 24), policy).recommendation).toBe("observe");
    const evaluation = evaluateMarket(history(), policy);
    expect(evaluation.recommendation).toBe("eligible");
    expect(evaluation.estimatedCapacityUsd).toBe(10_000);
  });

  it("does not reward a young pool for a one-day APR spike", () => {
    const evaluation = evaluateMarket(history({ poolAgeDays: 12, feeAprPct: 2_000 }), policy);
    expect(evaluation.recommendation).toBe("observe");
    expect(evaluation.reasons.join(" ")).toContain("younger than 30 days");
  });

  it("raises an immediate pause recommendation for hard security failures", () => {
    const evaluation = evaluateMarket(history({ incumbent: true, catalogStatus: "active", securityFlags: ["honeypot"] }, 2), policy);
    expect(evaluation.recommendation).toBe("pause");
    expect(evaluation.reasons).toContain("security: honeypot");
  });

  it("reviews low-turnover incumbents immediately", () => {
    const evaluation = evaluateMarket(history({ incumbent: true, catalogStatus: "active", volume24hUsd: 10_000, feeAprPct: 4 }, 0), policy);
    expect(evaluation.recommendation).toBe("review");
    expect(evaluation.reasons.join(" ")).toContain("daily volume");
  });

  it("distinguishes missing market data from a failed threshold", () => {
    const evaluation = evaluateMarket(history({ incumbent: true, catalogStatus: "active", liquidityUsd: null, volume24hUsd: null }, 0), policy);
    expect(evaluation.recommendation).toBe("review");
    expect(evaluation.reasons).toContain("pool liquidity data is unavailable");
    expect(evaluation.reasons).toContain("daily volume data is unavailable");
    expect(evaluation.reasons.join(" ")).not.toContain("below");
  });

  it("keeps recent security evidence through a transient provider outage", () => {
    const observations = history({ incumbent: true, catalogStatus: "active" }, 6);
    observations.at(-1)!.securityAvailable = false;
    expect(summarizeMarketHistory(observations, 60).latestSecurityAvailable).toBe(true);
    expect(evaluateMarket(observations, policy).recommendation).toBe("hold");
  });

  it("only proposes a same-chain replacement with a material fee advantage", () => {
    const candidate = evaluateMarket(history({ marketId: "base-candidate" }), policy);
    const incumbent = evaluateMarket(history({ marketId: "base-incumbent", symbol: "OLD", incumbent: true, catalogStatus: "active", feeAprPct: 8, volume24hUsd: 55_000, liquidityUsd: 500_000 }), policy);
    const proposals = proposeReplacements([candidate, incumbent], policy);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ candidateMarketId: "base-candidate", incumbentMarketId: "base-incumbent" });
    expect(proposals[0]!.aprMultiple).toBeGreaterThan(policy.replacementAprMultiplier);
  });
});
