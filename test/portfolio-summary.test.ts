import { describe, expect, it } from "vitest";
import type { PositionView } from "../app/lib/cards.js";
import { positionFeesEth, positionValueEth, positionValueUsd } from "../app/lib/portfolio-summary.js";

function position(overrides: Partial<PositionView> = {}): PositionView {
  return {
    kind: "live",
    protocol: "V3",
    pair: "MEME/WETH",
    fee: 3000,
    feeLabel: "0.30%",
    inRange: true,
    closed: false,
    fullRange: false,
    status: "in-range",
    tickLower: -100,
    tickUpper: 100,
    tickCurrent: 0,
    percentThroughRange: 50,
    price: 1,
    priceMin: 0.5,
    priceMax: 2,
    symbol0: "MEME",
    symbol1: "WETH",
    amount0: "1",
    amount1: "1",
    uncollected0: "0",
    uncollected1: "0",
    ...overrides,
  };
}

describe("position values", () => {
  it("derives position value from a combined LP value only when necessary", () => {
    expect(positionValueUsd(position({ lpUsd: 52, feesUsd: 2 }))).toBe(50);
    expect(positionValueUsd(position({ lpUsd: 52 }))).toBe(52);
  });

  it("derives an honest ETH value when Robinhood USD pricing is unavailable", () => {
    const live = position({
      amount0: "106.7467",
      amount1: "0.009853",
      uncollected0: "0.5",
      uncollected1: "0.0001",
      price: 0.000091395,
      positionUsd: 0,
      feesUsd: 0,
    });
    expect(positionValueEth(live)).toBeCloseTo(0.019609, 5);
    expect(positionFeesEth(live)).toBeCloseTo(0.0001457, 6);
  });

  it("supports WETH as token0 without guessing non-ETH pairs", () => {
    expect(positionValueEth(position({ symbol0: "WETH", symbol1: "MEME", amount0: "0.01", amount1: "100", price: 10_000 }))).toBeCloseTo(0.02);
    expect(positionValueEth(position({ symbol0: "MEME", symbol1: "USDC" }))).toBeUndefined();
  });
});
