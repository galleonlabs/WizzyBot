import { describe, expect, it } from "vitest";
import { selectBestVenue, type VenueObservation } from "../src/markets/venue-selection.js";

const now = "2026-09-01T20:00:00.000Z";

function venue(overrides: Partial<VenueObservation> = {}): VenueObservation {
  return {
    key: "PRIMARY",
    protocol: "V3",
    poolReference: "0x1111111111111111111111111111111111111111",
    executable: true,
    pairVerified: true,
    liquidityUsd: 2_000_000,
    volume24hUsd: 600_000,
    feePips: 3_000,
    poolAgeDays: 180,
    priceChange24hPct: 4,
    estimatedEntryCostUsd: 1.5,
    observedAt: now,
    ...overrides,
  };
}

describe("best venue selection", () => {
  it("does not let a shallow new pool win on a one-day fee spike", () => {
    const result = selectBestVenue([
      venue(),
      venue({
        key: "V4",
        protocol: "V4",
        poolReference: `0x${"2".repeat(64)}`,
        liquidityUsd: 18_000,
        volume24hUsd: 9_000_000,
        feePips: 10_000,
        poolAgeDays: 2,
      }),
    ], { now });

    expect(result.selectedKey).toBe("PRIMARY");
    expect(result.ranked.find((candidate) => candidate.key === "V4")).toMatchObject({
      eligible: false,
      rejectionReasons: expect.arrayContaining(["liquidity_below_floor", "pool_too_new"]),
    });
  });

  it("switches when a reviewed alternative is materially better and comparably deep", () => {
    const result = selectBestVenue([
      venue({ liquidityUsd: 1_000_000, volume24hUsd: 80_000, priceChange24hPct: 18 }),
      venue({
        key: "V4",
        protocol: "V4",
        poolReference: `0x${"3".repeat(64)}`,
        liquidityUsd: 900_000,
        volume24hUsd: 1_100_000,
        poolAgeDays: 240,
        priceChange24hPct: 3,
        estimatedEntryCostUsd: 1,
      }),
    ], { now });

    expect(result).toMatchObject({ selectedKey: "V4", selectedProtocol: "V4", switched: true, confidence: "high" });
  });

  it("keeps the incumbent when an alternative has only a marginal score lead", () => {
    const result = selectBestVenue([
      venue(),
      venue({
        key: "V2",
        protocol: "V2",
        poolReference: "0x2222222222222222222222222222222222222222",
        liquidityUsd: 2_050_000,
        volume24hUsd: 610_000,
        estimatedEntryCostUsd: 1,
      }),
    ], { now });

    expect(result.selectedKey).toBe("PRIMARY");
    expect(result.decisionReasons[0]).toContain("switch thresholds");
  });

  it("rejects stale, unverifiable, or non-executable venues", () => {
    const result = selectBestVenue([
      venue(),
      venue({
        key: "V4",
        protocol: "V4",
        poolReference: `0x${"4".repeat(64)}`,
        executable: false,
        pairVerified: false,
        liquidityUsd: 20_000_000,
        volume24hUsd: 20_000_000,
        observedAt: "2026-09-01T19:00:00.000Z",
      }),
    ], { now });

    expect(result.selectedKey).toBe("PRIMARY");
    expect(result.ranked.find((candidate) => candidate.key === "V4")?.rejectionReasons).toEqual(expect.arrayContaining([
      "not_executable",
      "pair_not_verified",
      "stale_observation",
    ]));
  });
});
