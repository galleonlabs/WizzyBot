import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { ADDRESSES } from "../src/constants.js";
import { buildCard } from "../src/core/card.js";
import { divergence, feeApr, holdUsd, lpUsd, rawToUsd, totalApr } from "../src/core/pnl.js";

const base = {
  hold0: 1_000000n, // 1 token0, 6 decimals
  hold1: 2_000000n, // 2 token1
  amount0: 500000n,
  amount1: 2_500000n,
  uncollected0: 100000n,
  uncollected1: 0n,
  price0Usd: 2,
  price1Usd: 1,
  decimals0: 6,
  decimals1: 6,
};

describe("HOLD / divergence", () => {
  it("values HOLD at current prices", () => {
    // 1 * $2 + 2 * $1 = $4
    expect(holdUsd(base)).toBe(4);
    expect(rawToUsd(1_000000n, 6, 2)).toBe(2);
  });

  it("LP = current amounts + uncollected fees", () => {
    // 0.5*$2 + 2.5*$1 + 0.1*$2 = 1 + 2.5 + 0.2 = 3.7
    expect(lpUsd(base)).toBeCloseTo(3.7);
  });

  it("divergence is (LP - HOLD) / HOLD", () => {
    // (3.7 - 4) / 4 = -0.075
    expect(divergence(base)).toBeCloseTo(-0.075);
  });

  it("positive fees can beat HOLD", () => {
    const ahead = { ...base, uncollected0: 2_000000n };
    expect(lpUsd(ahead)).toBeGreaterThan(holdUsd(ahead));
    expect(divergence(ahead)).toBeGreaterThan(0);
  });

  it("APR annualizes vs age", () => {
    expect(feeApr({ feesUsd: 10, notionalUsd: 100, ageDays: 365 })).toBeCloseTo(0.1);
    expect(totalApr({ lpUsd: 110, holdUsd: 100, ageDays: 365 })).toBeCloseTo(0.1);
    expect(feeApr({ feesUsd: 10, notionalUsd: 0, ageDays: 10 })).toBe(0);
  });

  it("buildCard uses rawToUsd for amount0Usd (not a notional remainder)", () => {
    const card = buildCard(
      {
        ref: { protocol: "V3", chainId: 8453, tokenId: 1n },
        owner: getAddress("0x1111111111111111111111111111111111111111"),
        token0: { address: ADDRESSES.weth, symbol: "WETH", decimals: 6 },
        token1: { address: ADDRESSES.usdc, symbol: "USDC", decimals: 6 },
        fee: 500,
        tickSpacing: 10,
        tickLower: -10,
        tickUpper: 10,
        tickCurrent: 0,
        sqrtPriceX96: 1n,
        liquidity: 1n,
        tokensOwed0: 0n,
        tokensOwed1: 0n,
        uncollected0: base.uncollected0,
        uncollected1: base.uncollected1,
        amount0: base.amount0,
        amount1: base.amount1,
        inRange: true,
        percentThroughRange: 50,
        pool: getAddress("0x2222222222222222222222222222222222222222"),
      },
      { price0Usd: base.price0Usd, price1Usd: base.price1Usd },
      { hold0: base.hold0, hold1: base.hold1 },
      1_700_000_000,
      1_700_000_000 + 86_400,
    );
    expect(card.amount0Usd).toBeCloseTo(1); // 0.5 * $2
    expect(card.amount1Usd).toBeCloseTo(2.5);
    expect(card.positionUsd).toBeCloseTo(3.5);
    expect(card.divergence).toBeCloseTo(-0.075);
  });
});
