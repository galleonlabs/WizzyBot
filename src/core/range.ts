/**
 * Uniswap v3 in-range test: liquidity is active when
 * tickLower <= tickCurrent < tickUpper.
 */
export function isInRange(
  tickCurrent: number,
  tickLower: number,
  tickUpper: number,
): boolean {
  return tickCurrent >= tickLower && tickCurrent < tickUpper;
}

export function isFullyOutOfRange(
  tickCurrent: number,
  tickLower: number,
  tickUpper: number,
): boolean {
  return !isInRange(tickCurrent, tickLower, tickUpper);
}

/**
 * 0% = at tickLower, 100% = at tickUpper.
 * Clamped so fully OOR still reports 0 or 100.
 */
export function percentThroughRange(
  tickCurrent: number,
  tickLower: number,
  tickUpper: number,
): number {
  const width = tickUpper - tickLower;
  if (width <= 0) return 0;
  const raw = ((tickCurrent - tickLower) / width) * 100;
  return Math.min(100, Math.max(0, raw));
}

/**
 * Auto-range trigger.
 * oorPercent = 0 → only fully out of range.
 * oorPercent = N → also fire when current tick is within N% of
 * the range width from either edge (near-edge rebalance).
 */
export function shouldRerange(args: {
  tickCurrent: number;
  tickLower: number;
  tickUpper: number;
  oorPercent: number;
}): boolean {
  const { tickCurrent, tickLower, tickUpper, oorPercent } = args;
  if (tickLower >= tickUpper) {
    throw new Error("invalid range");
  }
  if (isFullyOutOfRange(tickCurrent, tickLower, tickUpper)) {
    return true;
  }
  if (oorPercent <= 0) return false;
  if (oorPercent >= 50) {
    // 50%+ of width as a buffer means the whole in-range interval is "near edge".
    return true;
  }
  const width = tickUpper - tickLower;
  const buffer = (width * oorPercent) / 100;
  return tickCurrent < tickLower + buffer || tickCurrent >= tickUpper - buffer;
}

export function shouldExitAtPrice(args: {
  currentPrice: number;
  exitPrice: number;
  above: boolean;
}): boolean {
  if (!(args.currentPrice > 0) || !(args.exitPrice > 0)) {
    throw new Error("prices must be positive");
  }
  return args.above
    ? args.currentPrice >= args.exitPrice
    : args.currentPrice <= args.exitPrice;
}
