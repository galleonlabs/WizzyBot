import { describe, expect, it } from "vitest";
import { TREASURY } from "../src/constants.js";
import {
  COMPOUND_FEE_BPS,
  NOTIONAL_FEE_BPS,
  bpsOf,
  netAfterTake,
  resolveActionFee,
  RANGE_EXIT_FEE_BPS,
  takeFromFees,
  takeFromNotional,
} from "../src/core/fees.js";

const token0 = "0x4200000000000000000000000000000000000006";
const token1 = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

describe("2% fee-to-treasury math", () => {
  it("takes exactly 2% of each fee token", () => {
    const take = takeFromFees(1_000_000n, 50_000n, COMPOUND_FEE_BPS);
    expect(take.amount0).toBe(20_000n);
    expect(take.amount1).toBe(1_000n);
    expect(COMPOUND_FEE_BPS).toBe(200);
  });

  it("uses integer bps: 2% of 99 is 1", () => {
    expect(bpsOf(99n, 200)).toBe(1n);
    expect(bpsOf(0n, 200)).toBe(0n);
  });

  it("nets remaining fees after the take", () => {
    const take = takeFromFees(1_000n, 1_000n);
    const net = netAfterTake(1_000n, 1_000n, take.amount0, take.amount1);
    expect(net.amount0).toBe(980n);
    expect(net.amount1).toBe(980n);
  });

  it("notional take is 0.15%", () => {
    expect(NOTIONAL_FEE_BPS).toBe(15);
    const take = takeFromNotional(1_000_000n, 2_000_000n);
    expect(take.amount0).toBe(1_500n);
    expect(take.amount1).toBe(3_000n);
  });

  it("routes compound take to the product treasury", () => {
    const fee = resolveActionFee({
      action: "compound",
      feeSource: "fees",
      noFee: false,
      uncollected0: 10_000n,
      uncollected1: 0n,
      notional0: 1_000_000n,
      notional1: 1_000_000n,
      token0,
      token1,
    });
    expect(fee.recipient).toBe(TREASURY);
    expect(fee.recipient).toBe("0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42");
    expect(fee.bps).toBe(200);
    expect(fee.amount0).toBe(200n);
    expect(fee.skipped).toBe(false);
  });

  it("--no-fee skips the take", () => {
    const fee = resolveActionFee({
      action: "compound",
      feeSource: "fees",
      noFee: true,
      uncollected0: 10_000n,
      uncollected1: 10_000n,
      notional0: 1n,
      notional1: 1n,
      token0,
      token1,
    });
    expect(fee.skipped).toBe(true);
    expect(fee.amount0).toBe(0n);
    expect(fee.amount1).toBe(0n);
  });

  it("range/exit can take 0.15% of notional", () => {
    const fee = resolveActionFee({
      action: "rerange",
      feeSource: "notional",
      noFee: false,
      uncollected0: 10n,
      uncollected1: 10n,
      notional0: 1_000_000n,
      notional1: 1_000_000n,
      token0,
      token1,
    });
    expect(fee.source).toBe("notional");
    expect(fee.bps).toBe(15);
    expect(fee.amount0).toBe(1_500n);
  });

  it("range/exit on fee-source=fees takes 2% of uncollected", () => {
    expect(RANGE_EXIT_FEE_BPS).toBe(200);
    const fee = resolveActionFee({
      action: "exit",
      feeSource: "fees",
      noFee: false,
      uncollected0: 10_000n,
      uncollected1: 5_000n,
      notional0: 1_000_000n,
      notional1: 1_000_000n,
      token0,
      token1,
    });
    expect(fee.source).toBe("fees");
    expect(fee.bps).toBe(200);
    expect(fee.amount0).toBe(200n);
    expect(fee.amount1).toBe(100n);
    expect(fee.recipient).toBe("0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42");
  });

  it("labels the recipient as TREASURY without org branding", () => {
    expect(TREASURY).toBe("0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42");
    expect(`${TREASURY} treasury`).not.toMatch(/galleon/i);
  });

  it("rejects a take larger than the available amount", () => {
    expect(() => netAfterTake(10n, 10n, 11n, 0n)).toThrow(/exceeds/);
  });
});
