import { describe, expect, it } from "vitest";
import {
  emptyYieldQuestRecord,
  normalizeYieldQuestRecord,
  observeYieldPortfolio,
  yieldLevel,
  yieldQuestProgress,
  yieldQuestXp,
  YIELD_QUESTS,
} from "../app/lib/yield-quests.js";

describe("yield quests", () => {
  it("unlocks deposit and stack quests from one observation", () => {
    const { record, newlyUnlocked } = observeYieldPortfolio(emptyYieldQuestRecord(), { venueCount: 4, stackUsd: 1_200 });
    expect(newlyUnlocked).toEqual(expect.arrayContaining(["first-drip", "full-spread", "stack-100", "stack-500", "stack-1k"]));
    expect(newlyUnlocked).not.toContain("stack-5k");
    expect(record.depositedSince).not.toBeNull();
    expect(yieldQuestXp(record)).toBe(100 + 150 + 75 + 125 + 200);
  });

  it("keeps high-water marks and never re-unlocks", () => {
    const first = observeYieldPortfolio(emptyYieldQuestRecord(), { venueCount: 2, stackUsd: 600 });
    const second = observeYieldPortfolio(first.record, { venueCount: 1, stackUsd: 50 });
    expect(second.newlyUnlocked).toEqual([]);
    expect(second.record.maxStackUsd).toBe(600);
    expect(second.record.unlockedAt["stack-500"]).toBeDefined();
  });

  it("runs the streak from continuous deposits and resets on full exit", () => {
    const start = new Date("2026-09-01T00:00:00Z");
    const seeded = observeYieldPortfolio(emptyYieldQuestRecord(), { venueCount: 1, stackUsd: 100 }, start);
    const eightDays = new Date("2026-09-09T00:00:00Z");
    const week = observeYieldPortfolio(seeded.record, { venueCount: 1, stackUsd: 100 }, eightDays);
    expect(week.newlyUnlocked).toContain("steady-week");
    const exited = observeYieldPortfolio(week.record, { venueCount: 0, stackUsd: 0 }, eightDays);
    expect(exited.record.depositedSince).toBeNull();
  });

  it("levels and progress stay coherent", () => {
    expect(yieldLevel(0).title).toBe("Yield apprentice");
    expect(yieldLevel(2_500).nextMinimumXp).toBeNull();
    const record = observeYieldPortfolio(emptyYieldQuestRecord(), { venueCount: 1, stackUsd: 40 }).record;
    const progress = yieldQuestProgress(record, "stack-100");
    expect(progress.current).toBe(40);
    expect(progress.label).toBe("$40 of $100");
  });

  it("normalizes malformed stored records safely", () => {
    expect(normalizeYieldQuestRecord(null)).toMatchObject({ maxStackUsd: 0 });
    expect(normalizeYieldQuestRecord({ unlockedAt: { "not-a-quest": "2026-01-01" }, maxStackUsd: -5 }).maxStackUsd).toBe(0);
    expect(YIELD_QUESTS.length).toBeGreaterThan(5);
  });
});
