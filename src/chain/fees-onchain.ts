import { Q128 } from "../constants.js";

export interface TickFeeGrowth {
  feeGrowthOutside0X128: bigint;
  feeGrowthOutside1X128: bigint;
}

/**
 * Uniswap v3 uncollected fees:
 * tokensOwed += (feeGrowthInside - feeGrowthInsideLast) * liquidity / 2^128
 */
export function feeGrowthInside(args: {
  tickCurrent: number;
  tickLower: number;
  tickUpper: number;
  feeGrowthGlobal0X128: bigint;
  feeGrowthGlobal1X128: bigint;
  lower: TickFeeGrowth;
  upper: TickFeeGrowth;
}): { inside0: bigint; inside1: bigint } {
  const below0 = args.tickCurrent >= args.tickLower
    ? args.lower.feeGrowthOutside0X128
    : args.feeGrowthGlobal0X128 - args.lower.feeGrowthOutside0X128;
  const below1 = args.tickCurrent >= args.tickLower
    ? args.lower.feeGrowthOutside1X128
    : args.feeGrowthGlobal1X128 - args.lower.feeGrowthOutside1X128;

  const above0 = args.tickCurrent < args.tickUpper
    ? args.upper.feeGrowthOutside0X128
    : args.feeGrowthGlobal0X128 - args.upper.feeGrowthOutside0X128;
  const above1 = args.tickCurrent < args.tickUpper
    ? args.upper.feeGrowthOutside1X128
    : args.feeGrowthGlobal1X128 - args.upper.feeGrowthOutside1X128;

  return {
    inside0: args.feeGrowthGlobal0X128 - below0 - above0,
    inside1: args.feeGrowthGlobal1X128 - below1 - above1,
  };
}

export function uncollectedFees(args: {
  liquidity: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  inside0: bigint;
  inside1: bigint;
}): { amount0: bigint; amount1: bigint } {
  const delta0 = args.inside0 - args.feeGrowthInside0LastX128;
  const delta1 = args.inside1 - args.feeGrowthInside1LastX128;
  const extra0 = args.liquidity === 0n ? 0n : (delta0 * args.liquidity) / Q128;
  const extra1 = args.liquidity === 0n ? 0n : (delta1 * args.liquidity) / Q128;
  return {
    amount0: args.tokensOwed0 + extra0,
    amount1: args.tokensOwed1 + extra1,
  };
}
