import { describe, expect, it } from "vitest";
import {
  buildLiquidityBins,
  floorDiv,
  initializedTicksFromBitmap,
} from "../src/portfolio/liquidity-profile.js";

describe("live concentrated-liquidity profile", () => {
  it("uses arithmetic floor division for negative ticks", () => {
    expect(floorDiv(-1, 256)).toBe(-1);
    expect(floorDiv(-256, 256)).toBe(-1);
    expect(floorDiv(-257, 256)).toBe(-2);
  });

  it("decodes initialized ticks from negative bitmap words", () => {
    const bitmap = (1n << 0n) | (1n << 255n);
    expect(initializedTicksFromBitmap(-1, bitmap, 10)).toEqual([-2560, -10]);
  });

  it("reconstructs liquidity on both sides of the active tick", () => {
    const bins = buildLiquidityBins({
      activeLiquidity: 100n,
      tickCurrent: 0,
      tickSpacing: 1,
      tickLower: -20,
      tickUpper: 20,
      liquidityNet: new Map([
        [-10, 30n],
        [10, -20n],
      ]),
      binCount: 4,
    });

    expect(bins.map((bin) => bin.liquidity)).toEqual(["70", "100", "100", "80"]);
    expect(bins.map((bin) => bin.height)).toEqual([0.7, 1, 1, 0.8]);
  });

  it("keeps bigint arithmetic exact before display normalization", () => {
    const huge = 2n ** 120n;
    const bins = buildLiquidityBins({
      activeLiquidity: huge,
      tickCurrent: 0,
      tickSpacing: 1,
      tickLower: 0,
      tickUpper: 2,
      liquidityNet: new Map([[1, -(huge / 2n)]]),
      binCount: 2,
    });
    expect(bins[0]?.liquidity).toBe(huge.toString());
    expect(bins[1]?.liquidity).toBe((huge / 2n).toString());
    expect(bins[1]?.height).toBe(0.5);
  });
});
