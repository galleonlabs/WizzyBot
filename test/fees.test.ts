import { describe, expect, it } from "vitest";
import { TREASURY } from "../src/constants.js";
import {
  COMPOUND_FEE_BPS,
  NOTIONAL_FEE_BPS,
  RANGE_EXIT_FEE_BPS,
  bpsOf,
  netAfterTake,
  resolveActionFee,
  takeFromFees,
  takeFromNotional,
} from "../src/core/fees.js";

const token0 = "0x4200000000000000000000000000000000000006";
const token1 = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

describe("fee policy", () => {
  it("keeps every non-atomic product action fee at zero", () => {
    expect(COMPOUND_FEE_BPS).toBe(0);
    expect(RANGE_EXIT_FEE_BPS).toBe(0);
    expect(NOTIONAL_FEE_BPS).toBe(0);
  });

  it("retains explicit basis-point math without applying it by default", () => {
    expect(bpsOf(99n, 200)).toBe(1n);
    expect(takeFromFees(1_000_000n, 50_000n, 200)).toEqual({ amount0: 20_000n, amount1: 1_000n });
    expect(takeFromNotional(1_000_000n, 2_000_000n, 15)).toEqual({ amount0: 1_500n, amount1: 3_000n });
    expect(takeFromFees(1_000n, 1_000n)).toEqual({ amount0: 0n, amount1: 0n });
  });

  it.each([
    ["compound", "fees"],
    ["rerange", "notional"],
    ["exit", "fees"],
  ] as const)("does not create a treasury take for %s", (action, feeSource) => {
    const fee = resolveActionFee({
      action,
      feeSource,
      noFee: false,
      uncollected0: 10_000n,
      uncollected1: 5_000n,
      notional0: 1_000_000n,
      notional1: 2_000_000n,
      token0,
      token1,
    });
    expect(fee).toMatchObject({ bps: 0, skipped: true, amount0: 0n, amount1: 0n });
  });

  it("keeps all value after a zero take", () => {
    const take = takeFromFees(1_000n, 1_000n);
    expect(netAfterTake(1_000n, 1_000n, take.amount0, take.amount1)).toEqual({ amount0: 1_000n, amount1: 1_000n });
  });

  it("retains the dedicated treasury identity without routing action fees to it", () => {
    expect(TREASURY).toBe("0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42");
    expect(`${TREASURY} treasury`).not.toMatch(/galleon/i);
  });

  it("rejects a take larger than the available amount", () => {
    expect(() => netAfterTake(10n, 10n, 11n, 0n)).toThrow(/exceeds/);
  });
});
