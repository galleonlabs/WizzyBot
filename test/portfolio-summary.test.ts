import { describe, expect, it } from "vitest";
import type { PositionView } from "../app/lib/cards.js";
import { positionFeesEth, positionValueEth, positionValueUsd, summarizePositions } from "../app/lib/portfolio-summary.js";

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

describe("portfolio fee summary", () => {
  it("keeps current position value separate from unclaimed fees", () => {
    const first = position({ positionUsd: 100, feesUsd: 4, lpUsd: 104, feeApr: 0.2 });
    const second = position({ positionUsd: 300, feesUsd: 6, lpUsd: 306, feeApr: 0.1, status: "oor", inRange: false });
    expect(summarizePositions([first, second])).toEqual({
      priced: 2,
      valueUsd: 400,
      feesPriced: 2,
      feesUsd: 10,
      earning: 1,
      feeApr: 0.125,
    });
  });

  it("derives position value from a combined LP value only when necessary", () => {
    expect(positionValueUsd(position({ lpUsd: 52, feesUsd: 2 }))).toBe(50);
    expect(positionValueUsd(position({ lpUsd: 52 }))).toBe(52);
  });

  it("does not invent values for an empty or unpriced wallet", () => {
    expect(summarizePositions([])).toEqual({ priced: 0, valueUsd: 0, feesPriced: 0, feesUsd: 0, earning: 0, feeApr: null });
    expect(summarizePositions([position()])).toEqual({ priced: 0, valueUsd: 0, feesPriced: 0, feesUsd: 0, earning: 1, feeApr: null });
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
