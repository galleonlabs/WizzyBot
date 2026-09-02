import { BPS_DENOMINATOR, FEE_TIER, TREASURY } from "../constants.js";
import type { Address } from "viem";
import type { FeeSource, TreasuryFee } from "../types.js";

export const COMPOUND_FEE_BPS = FEE_TIER.compoundBps;
export const RANGE_EXIT_FEE_BPS = FEE_TIER.rangeExitFeeBps;
export const NOTIONAL_FEE_BPS = FEE_TIER.notionalBps;

export function bpsOf(amount: bigint, bps: number): bigint {
  if (bps < 0 || bps > 10_000) {
    throw new Error(`bps out of range: ${bps}`);
  }
  if (amount <= 0n) return 0n;
  return (amount * BigInt(bps)) / BPS_DENOMINATOR;
}

/** Apply an explicit basis-point amount. Product action fees default to zero. */
export function takeFromFees(amount0: bigint, amount1: bigint, bps: number = COMPOUND_FEE_BPS) {
  return { amount0: bpsOf(amount0, bps), amount1: bpsOf(amount1, bps) };
}

/** Apply an explicit basis-point amount to each position token. */
export function takeFromNotional(
  amount0: bigint,
  amount1: bigint,
  bps: number = NOTIONAL_FEE_BPS,
): { amount0: bigint; amount1: bigint } {
  return { amount0: bpsOf(amount0, bps), amount1: bpsOf(amount1, bps) };
}

export function netAfterTake(
  amount0: bigint,
  amount1: bigint,
  take0: bigint,
  take1: bigint,
): { amount0: bigint; amount1: bigint } {
  if (take0 > amount0 || take1 > amount1) {
    throw new Error("treasury take exceeds available amount");
  }
  return { amount0: amount0 - take0, amount1: amount1 - take1 };
}

export function buildTreasuryFee(args: {
  source: FeeSource;
  bps: number;
  skipped: boolean;
  token0: Address;
  token1: Address;
  amount0: bigint;
  amount1: bigint;
  usd?: number;
  recipient?: Address;
}): TreasuryFee {
  return {
    source: args.source,
    bps: args.skipped ? 0 : args.bps,
    skipped: args.skipped,
    recipient: args.recipient ?? TREASURY,
    token0: args.token0,
    token1: args.token1,
    amount0: args.skipped ? 0n : args.amount0,
    amount1: args.skipped ? 0n : args.amount1,
    usd: args.usd,
  };
}

export function resolveActionFee(args: {
  action: "compound" | "rerange" | "exit";
  feeSource: FeeSource;
  noFee: boolean;
  uncollected0: bigint;
  uncollected1: bigint;
  notional0: bigint;
  notional1: bigint;
  token0: Address;
  token1: Address;
}): TreasuryFee {
  return buildTreasuryFee({
    source: args.action === "compound" ? "fees" : args.feeSource,
    bps: 0,
    skipped: true,
    token0: args.token0,
    token1: args.token1,
    amount0: 0n,
    amount1: 0n,
  });
}
