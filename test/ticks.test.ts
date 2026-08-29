import { describe, expect, it } from "vitest";
import { nearestUsableTick } from "@uniswap/v3-sdk";
import { rangeFromWidthPct, recenterSameWidth, snapRange, snapTick, tickSpacingForFee } from "../src/core/ticks.js";

describe("tick snap", () => {
  it("snaps to fee-tier spacing via v3-sdk nearestUsableTick", () => {
    expect(tickSpacingForFee(500)).toBe(10);
    expect(tickSpacingForFee(3000)).toBe(60);
    expect(snapTick(7, 10)).toBe(nearestUsableTick(7, 10));
    expect(snapTick(7, 10) % 10).toBe(0);
    expect(Number.isInteger(snapTick(-14, 10) / 10)).toBe(true);
  });

  it("rejects unknown fee tiers", () => {
    expect(() => tickSpacingForFee(123)).toThrow(/Unsupported/);
  });

  it("keeps snapped lower < upper", () => {
    const range = snapRange(12, 18, 10);
    expect(range.tickLower).toBeLessThan(range.tickUpper);
    expect(Number.isInteger(range.tickLower / 10)).toBe(true);
    expect(range.tickUpper % 10).toBe(0);
  });

  it("builds a width-pct range around current tick", () => {
    const range = rangeFromWidthPct(0, 10, 10);
    expect(range.tickLower).toBeLessThan(0);
    expect(range.tickUpper).toBeGreaterThan(0);
    expect(Number.isInteger(range.tickLower / 10)).toBe(true);
  });

  it("re-centers with the same width", () => {
    const next = recenterSameWidth(-200, 200, 50, 10);
    expect(next.tickUpper - next.tickLower).toBe(400);
    expect(next.tickLower).toBeLessThan(50);
    expect(next.tickUpper).toBeGreaterThan(50);
  });
});
