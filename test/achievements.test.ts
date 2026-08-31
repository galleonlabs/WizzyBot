import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  achievementLevel,
  achievementProgress,
  achievementXp,
  emptyAchievementRecord,
  mergeAchievementRecords,
  normalizeAchievementRecord,
  observeAchievementProgress,
  recordAchievementAction,
} from "../app/lib/achievements.js";

const NOW = "2026-08-31T09:00:00.000Z";

describe("Wizzy quests", () => {
  it("unlocks wallet-state quests from real position and fee observations", () => {
    const result = observeAchievementProgress(emptyAchievementRecord(NOW), {
      positionCount: 6,
      marketCount: 6,
      feesUsd: 124.72,
    }, NOW);
    expect(result.newlyUnlocked).toEqual(["first-spell", "full-spellbook", "first-fees", "fee-collector", "pocket-full", "half-century", "triple-digits"]);
    expect(achievementXp(result.record)).toBe(800);
    expect(achievementLevel(achievementXp(result.record))).toMatchObject({ level: 3, title: "Liquidity wizard" });
  });

  it("preserves earned milestones when current fees or positions later fall", () => {
    const earned = observeAchievementProgress(emptyAchievementRecord(NOW), { positionCount: 6, marketCount: 6, feesUsd: 100 }, NOW).record;
    const later = observeAchievementProgress(earned, { positionCount: 1, marketCount: 1, feesUsd: 0 }, "2026-09-01T09:00:00.000Z").record;
    expect(later.maxPositionCount).toBe(6);
    expect(later.maxMarketCount).toBe(6);
    expect(later.maxFeesUsd).toBe(100);
    expect(later.unlockedAt["triple-digits"]).toBe(NOW);
  });

  it("records only confirmed compound and rebalance actions", () => {
    const compounded = recordAchievementAction(emptyAchievementRecord(NOW), "compound", NOW);
    expect(compounded.newlyUnlocked).toEqual(["compounder"]);
    expect(compounded.record.compoundCount).toBe(1);
    expect(compounded.record.rebalanceCount).toBe(0);
    const rebalanced = recordAchievementAction(compounded.record, "rebalance", NOW);
    expect(rebalanced.newlyUnlocked).toEqual(["range-keeper"]);
    expect(achievementXp(rebalanced.record)).toBe(350);
  });

  it("merges local and Privy copies without losing the earliest unlock date", () => {
    const local = recordAchievementAction(emptyAchievementRecord(NOW), "compound", NOW).record;
    const remote = observeAchievementProgress(emptyAchievementRecord(NOW), { positionCount: 1, marketCount: 1, feesUsd: 12 }, "2026-08-30T09:00:00.000Z").record;
    const merged = mergeAchievementRecords(local, remote, "2026-09-01T09:00:00.000Z");
    expect(Object.keys(merged.unlockedAt).sort()).toEqual(["compounder", "fee-collector", "first-fees", "first-spell"]);
    expect(merged.unlockedAt["first-spell"]).toBe("2026-08-30T09:00:00.000Z");
    expect(merged.compoundCount).toBe(1);
    expect(merged.maxFeesUsd).toBe(12);
  });

  it("normalizes hostile storage data and keeps progress labels concise", () => {
    const record = normalizeAchievementRecord({
      unlockedAt: { unknown: NOW, "first-spell": "not-a-date" },
      maxPositionCount: -20,
      maxMarketCount: Number.POSITIVE_INFINITY,
      maxFeesUsd: 7.25,
      compoundCount: 99_999,
    }, NOW);
    expect(record.maxPositionCount).toBe(0);
    expect(record.maxMarketCount).toBe(0);
    expect(record.compoundCount).toBe(10_000);
    expect(record.unlockedAt.compounder).toBe(NOW);
    expect(achievementProgress(record, "fee-collector").label).toBe("$7.25 of $10 fees");
    expect(ACHIEVEMENTS).toHaveLength(12);
  });

  it("builds a complete fee ladder without leaving XP above the top level", () => {
    const result = observeAchievementProgress(emptyAchievementRecord(NOW), {
      positionCount: 6,
      marketCount: 6,
      feesUsd: 1_000,
    }, NOW);
    expect(result.newlyUnlocked).toHaveLength(10);
    const feeTargets = ACHIEVEMENTS.filter((quest) => quest.metric === "fees").map((quest) => quest.target);
    expect(feeTargets).toEqual([1, 10, 25, 50, 100, 250, 500, 1_000]);
    const completed = recordAchievementAction(recordAchievementAction(result.record, "compound", NOW).record, "rebalance", NOW).record;
    expect(achievementXp(completed)).toBe(2_275);
    expect(achievementLevel(achievementXp(completed))).toMatchObject({ level: 6, title: "Market myth", nextMinimumXp: null });
  });
});
