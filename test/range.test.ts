import { describe, expect, it } from "vitest";
import { isInRange, percentThroughRange, shouldExitAtPrice, shouldRerange } from "../src/core/range.js";

describe("in-range", () => {
  it("is active on [lower, upper)", () => {
    expect(isInRange(0, -10, 10)).toBe(true);
    expect(isInRange(-10, -10, 10)).toBe(true);
    expect(isInRange(10, -10, 10)).toBe(false);
    expect(isInRange(-11, -10, 10)).toBe(false);
  });
});

describe("OOR trigger", () => {
  it("oorPercent=0 fires only when fully OOR", () => {
    expect(shouldRerange({ tickCurrent: 0, tickLower: -100, tickUpper: 100, oorPercent: 0 })).toBe(false);
    expect(shouldRerange({ tickCurrent: -100, tickLower: -100, tickUpper: 100, oorPercent: 0 })).toBe(false);
    expect(shouldRerange({ tickCurrent: -101, tickLower: -100, tickUpper: 100, oorPercent: 0 })).toBe(true);
    expect(shouldRerange({ tickCurrent: 100, tickLower: -100, tickUpper: 100, oorPercent: 0 })).toBe(true);
  });

  it("oorPercent>0 also fires near either edge", () => {
    expect(shouldRerange({ tickCurrent: -90, tickLower: -100, tickUpper: 100, oorPercent: 10 })).toBe(true);
    expect(shouldRerange({ tickCurrent: 0, tickLower: -100, tickUpper: 100, oorPercent: 10 })).toBe(false);
    expect(shouldRerange({ tickCurrent: 91, tickLower: -100, tickUpper: 100, oorPercent: 10 })).toBe(true);
  });

  it("percent through range is 0-100", () => {
    expect(percentThroughRange(-100, -100, 100)).toBe(0);
    expect(percentThroughRange(0, -100, 100)).toBe(50);
    expect(percentThroughRange(100, -100, 100)).toBe(100);
  });
});

describe("exit price", () => {
  it("triggers at or beyond the target", () => {
    expect(shouldExitAtPrice({ currentPrice: 3500, exitPrice: 3400, above: true })).toBe(true);
    expect(shouldExitAtPrice({ currentPrice: 3300, exitPrice: 3400, above: true })).toBe(false);
    expect(shouldExitAtPrice({ currentPrice: 0.9, exitPrice: 1, above: false })).toBe(true);
  });
});
