import { describe, expect, it } from "vitest";
import {
  impliedEthUsd,
  memePriceAtTick,
  positionOrientation,
  rangeBounds,
  rangeFromMemePrices,
  rangeFromPercent,
  recenteredRange,
  summarizePositions,
  tickForMemePrice,
} from "../app/lib/position-math.js";

const cashcat = { symbol0: "CASHCAT", symbol1: "WETH", price: 0.00011205977414677368, tickCurrent: -90970, tickLower: -100380, tickUpper: -86520, tickSpacing: 60, fee: 3000, fullRange: false };
const surplus = { symbol0: "WETH", symbol1: "Surplus", price: 61640100.08339874, tickCurrent: 179377, tickLower: 170400, tickUpper: 184200, tickSpacing: 200, fee: 10000, fullRange: false };

describe("position pricing", () => {
  it("reads every pool as ETH per meme regardless of token order", () => {
    expect(positionOrientation(cashcat)).toEqual({ quoteIsToken0: false, memeSymbol: "CASHCAT", quoteSymbol: "WETH" });
    expect(positionOrientation(surplus)).toEqual({ quoteIsToken0: true, memeSymbol: "Surplus", quoteSymbol: "WETH" });
    expect(memePriceAtTick(cashcat, cashcat.tickCurrent)).toBeCloseTo(0.000112, 6);
    expect(memePriceAtTick(surplus, surplus.tickCurrent)).toBeCloseTo(1 / 61640100, 12);
  });

  it("orders inverted ranges so the minimum is always the lower meme price", () => {
    const bounds = rangeBounds(surplus);
    expect(bounds.min).toBeLessThan(bounds.max!);
    expect(bounds.min / (1 / 99839959.94)).toBeCloseTo(1, 3);
    expect(bounds.max! / (1 / 25119325.72)).toBeCloseTo(1, 3);
    expect(rangeBounds({ ...cashcat, fullRange: true })).toEqual({ min: 0, max: null });
  });

  it("round-trips a meme price through tick space", () => {
    const price = 0.00015;
    const tick = tickForMemePrice(cashcat, price);
    expect(memePriceAtTick(cashcat, tick)).toBeCloseTo(price, 9);
    const invertedTick = tickForMemePrice(surplus, 2e-8);
    expect(memePriceAtTick(surplus, invertedTick)).toBeCloseTo(2e-8, 12);
  });

  it("builds snapped ranges from presets and explicit prices", () => {
    const pct = rangeFromPercent(cashcat, 25);
    expect(Math.abs(pct.tickLower % 60)).toBe(0);
    expect(Math.abs(pct.tickUpper % 60)).toBe(0);
    expect(pct.tickLower).toBeLessThan(cashcat.tickCurrent);
    expect(pct.tickUpper).toBeGreaterThan(cashcat.tickCurrent);
    expect(memePriceAtTick(cashcat, pct.tickUpper) / memePriceAtTick(cashcat, cashcat.tickCurrent)).toBeCloseTo(1.25, 1);

    const recentred = recenteredRange(cashcat);
    expect(recentred.tickUpper - recentred.tickLower).toBe(cashcat.tickUpper - cashcat.tickLower);

    const custom = rangeFromMemePrices(surplus, 1.2e-8, 3e-8);
    expect(Math.abs(custom.tickLower % 200)).toBe(0);
    expect(custom.tickLower).toBeLessThan(custom.tickUpper);
    const bounds = rangeBounds(surplus, custom);
    expect(bounds.min).toBeLessThanOrEqual(1.2e-8 * 1.03);
    expect(bounds.max).toBeGreaterThanOrEqual(3e-8 * 0.97);
    expect(() => rangeFromMemePrices(cashcat, 0.0002, 0.0001)).toThrow("below the maximum");
  });

  it("summarises a wallet and infers the ETH price from any ETH leg", () => {
    const positions = [
      { positionUsd: 48_019, feesUsd: 384.7, status: "in-range" as const, closed: false, symbol0: "CASHCAT", symbol1: "WETH", amount0: "77,592.75", amount1: "16.362", amount0Usd: 9113, amount1Usd: 38905 },
      { positionUsd: 11_794, feesUsd: 44.4, status: "oor" as const, closed: false, symbol0: "WETH", symbol1: "Surplus", amount0: "1.8485", amount1: "192,316,494.59", amount0Usd: 4395, amount1Usd: 7398 },
    ];
    const summary = summarizePositions(positions);
    expect(summary).toMatchObject({ valueUsd: 59_813, priced: 2, inRange: 1, total: 2 });
    expect(summary.feesUsd).toBeCloseTo(429.1, 6);
    expect(impliedEthUsd(positions)).toBeCloseTo(38905 / 16.362, 3);
    expect(impliedEthUsd([{ ...positions[0]!, amount1: "0", amount1Usd: 0 }])).toBeUndefined();
  });
});
