import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  achievementLevel,
  achievementProgress,
  achievementXp,
  emptyAchievementRecord,
  normalizeAchievementRecord,
  observeOnchainPortfolio,
  recordVerifiedAchievementAction,
  serializeAchievementRecord,
  type AchievementAction,
} from "../app/lib/achievements.js";

const NOW = "2026-08-31T09:00:00.000Z";
const HASH = `0x${"ab".repeat(32)}` as const;

function proof(action: AchievementAction, transactionHash = HASH) {
  return { action, chainId: 4663 as const, tokenId: "941", transactionHash, verifiedAt: NOW };
}

function observe(record: ReturnType<typeof emptyAchievementRecord>, positionCount: number, marketCount: number, feesUsd: number, now = NOW) {
  return observeOnchainPortfolio(record, {
    positionCount,
    marketCount,
    positions: [{ key: "0xpool:941", feesUsd }],
  }, now);
}

describe("Wizzy quests", () => {
  it("unlocks wallet-state quests from real position and fee observations", () => {
    const result = observe(emptyAchievementRecord(NOW), 6, 6, 124.72);
    expect(result.newlyUnlocked).toEqual(["first-spell", "full-spellbook", "first-fees", "fee-collector", "pocket-full", "half-century", "triple-digits"]);
    expect(achievementXp(result.record)).toBe(800);
    expect(achievementLevel(achievementXp(result.record))).toMatchObject({ level: 3, title: "Liquidity wizard" });
  });

  it("preserves earned milestones when current fees or positions later fall", () => {
    const earned = observe(emptyAchievementRecord(NOW), 6, 6, 100).record;
    const later = observe(earned, 1, 1, 0, "2026-09-01T09:00:00.000Z").record;
    expect(later.maxPositionCount).toBe(6);
    expect(later.maxMarketCount).toBe(6);
    expect(later.feesEarnedUsd).toBe(100);
    expect(later.unlockedAt["triple-digits"]).toBe(NOW);
  });

  it("records only confirmed compound and rebalance actions", () => {
    const compounded = recordVerifiedAchievementAction(emptyAchievementRecord(NOW), proof("compound"));
    expect(compounded.newlyUnlocked).toEqual(["compounder"]);
    expect(compounded.record.compoundCount).toBe(1);
    expect(compounded.record.rebalanceCount).toBe(0);
    const rebalanced = recordVerifiedAchievementAction(compounded.record, proof("rebalance", `0x${"cd".repeat(32)}`));
    expect(rebalanced.newlyUnlocked).toEqual(["range-keeper"]);
    expect(achievementXp(rebalanced.record)).toBe(350);
    expect(recordVerifiedAchievementAction(compounded.record, proof("compound")).record.compoundCount).toBe(1);
  });

  it("round-trips only server-authoritative progress and receipt proofs", () => {
    const earned = observe(emptyAchievementRecord(NOW), 1, 1, 12).record;
    const verified = recordVerifiedAchievementAction(earned, proof("compound")).record;
    const stored = serializeAchievementRecord(verified);
    const restored = normalizeAchievementRecord(JSON.parse(stored), "2026-09-01T09:00:00.000Z");
    expect(Object.keys(restored.unlockedAt).sort()).toEqual(["compounder", "fee-collector", "first-fees", "first-spell"]);
    expect(restored.proofs.compound?.transactionHash).toBe(HASH);
    expect(restored.compoundCount).toBe(1);
    expect(restored.feesEarnedUsd).toBe(12);
    expect(Buffer.byteLength(stored)).toBeLessThan(1_000);
  });

  it("normalizes hostile storage data and keeps progress labels concise", () => {
    const legacy = normalizeAchievementRecord({
      version: 1,
      unlockedAt: { unknown: NOW, "first-spell": "not-a-date" },
      maxPositionCount: -20,
      maxMarketCount: Number.POSITIVE_INFINITY,
      maxFeesUsd: 7.25,
      compoundCount: 99_999,
    }, NOW);
    expect(legacy.maxPositionCount).toBe(0);
    expect(legacy.feesEarnedUsd).toBe(0);
    const record = observe(legacy, 0, 0, 7.25).record;
    expect(record.compoundCount).toBe(0);
    expect(record.unlockedAt.compounder).toBeUndefined();
    expect(achievementProgress(record, "fee-collector").label).toBe("$7.25 of $10 fees");
    expect(ACHIEVEMENTS).toHaveLength(12);
  });

  it("accumulates server-observed fee growth without double-counting collection resets", () => {
    const first = observeOnchainPortfolio(emptyAchievementRecord(NOW), {
      positionCount: 1,
      marketCount: 1,
      positions: [{ key: "0xpool:941", feesUsd: 4 }],
    }, NOW).record;
    const grown = observeOnchainPortfolio(first, {
      positionCount: 1,
      marketCount: 1,
      positions: [{ key: "0xpool:941", feesUsd: 9 }],
    }, "2026-09-01T09:00:00.000Z").record;
    const collected = observeOnchainPortfolio(grown, {
      positionCount: 1,
      marketCount: 1,
      positions: [{ key: "0xpool:941", feesUsd: 0 }],
    }, "2026-09-02T09:00:00.000Z").record;
    const earnedAgain = observeOnchainPortfolio(collected, {
      positionCount: 1,
      marketCount: 1,
      positions: [{ key: "0xpool:941", feesUsd: 3 }],
    }, "2026-09-03T09:00:00.000Z").record;
    expect(first.feesEarnedUsd).toBe(4);
    expect(grown.feesEarnedUsd).toBe(9);
    expect(collected.feesEarnedUsd).toBe(9);
    expect(earnedAgain.feesEarnedUsd).toBe(12);
  });

  it("builds a complete fee ladder without leaving XP above the top level", () => {
    const result = observe(emptyAchievementRecord(NOW), 6, 6, 1_000);
    expect(result.newlyUnlocked).toHaveLength(10);
    const feeTargets = ACHIEVEMENTS.filter((quest) => quest.metric === "fees").map((quest) => quest.target);
    expect(feeTargets).toEqual([1, 10, 25, 50, 100, 250, 500, 1_000]);
    const completed = recordVerifiedAchievementAction(
      recordVerifiedAchievementAction(result.record, proof("compound")).record,
      proof("rebalance", `0x${"cd".repeat(32)}`),
    ).record;
    expect(achievementXp(completed)).toBe(2_275);
    expect(achievementLevel(achievementXp(completed))).toMatchObject({ level: 6, title: "Market myth", nextMinimumXp: null });
    expect(Buffer.byteLength(serializeAchievementRecord(completed))).toBeLessThan(1_000);
  });
});
