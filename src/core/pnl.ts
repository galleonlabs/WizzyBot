export interface HoldInput {
  /** Token amounts at first mint / last baseline, in raw units. */
  hold0: bigint;
  hold1: bigint;
  /** Current in-position amounts. */
  amount0: bigint;
  amount1: bigint;
  uncollected0: bigint;
  uncollected1: bigint;
  /** USD prices per whole token (not per raw unit). */
  price0Usd: number;
  price1Usd: number;
  decimals0: number;
  decimals1: number;
}

export function rawToUsd(
  raw: bigint,
  decimals: number,
  priceUsd: number,
): number {
  if (raw === 0n || priceUsd === 0) return 0;
  const whole = Number(raw) / 10 ** decimals;
  return whole * priceUsd;
}

export function positionNotionalUsd(input: HoldInput): number {
  return (
    rawToUsd(input.amount0, input.decimals0, input.price0Usd) +
    rawToUsd(input.amount1, input.decimals1, input.price1Usd)
  );
}

export function feesUsd(input: HoldInput): number {
  return (
    rawToUsd(input.uncollected0, input.decimals0, input.price0Usd) +
    rawToUsd(input.uncollected1, input.decimals1, input.price1Usd)
  );
}

export function holdUsd(input: HoldInput): number {
  return (
    rawToUsd(input.hold0, input.decimals0, input.price0Usd) +
    rawToUsd(input.hold1, input.decimals1, input.price1Usd)
  );
}

export function lpUsd(input: HoldInput): number {
  return positionNotionalUsd(input) + feesUsd(input);
}

/**
 * Divergence vs HOLD: (LP - HOLD) / HOLD.
 * Negative means the LP underperformed just holding the entry bag.
 */
export function divergence(input: HoldInput): number {
  const hold = holdUsd(input);
  if (hold === 0) return 0;
  return (lpUsd(input) - hold) / hold;
}

export function feeApr(args: {
  feesUsd: number;
  notionalUsd: number;
  ageDays: number;
}): number {
  if (args.notionalUsd <= 0 || args.ageDays <= 0) return 0;
  return (args.feesUsd / args.notionalUsd) * (365 / args.ageDays);
}

export function totalApr(args: {
  lpUsd: number;
  holdUsd: number;
  ageDays: number;
}): number {
  if (args.holdUsd <= 0 || args.ageDays <= 0) return 0;
  return ((args.lpUsd - args.holdUsd) / args.holdUsd) * (365 / args.ageDays);
}

export function ageDays(createdAtSec: number, nowSec = Date.now() / 1000): number {
  if (createdAtSec <= 0) return 0;
  return Math.max(0, (nowSec - createdAtSec) / 86_400);
}
