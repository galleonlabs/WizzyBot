import { describe, expect, it } from "vitest";
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
});
