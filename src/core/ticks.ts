import { nearestUsableTick, TickMath } from "@uniswap/v3-sdk";
import { FEE_AMOUNT_TICK_SPACING, MAX_TICK, MIN_TICK } from "../constants.js";

export function tickSpacingForFee(fee: number): number {
  const spacing = FEE_AMOUNT_TICK_SPACING[fee];
  if (spacing === undefined) {
    throw new Error(`Unsupported Uniswap v3 fee tier: ${fee}`);
  }
  return spacing;
}

export function snapTick(tick: number, spacing: number): number {
  if (!Number.isInteger(tick) || !Number.isInteger(spacing) || spacing <= 0) {
    throw new Error("tick and spacing must be positive integers");
  }
  const clamped = Math.max(MIN_TICK, Math.min(MAX_TICK, tick));
  return nearestUsableTick(clamped, spacing);
}

export function snapRange(
  tickLower: number,
  tickUpper: number,
  spacing: number,
): { tickLower: number; tickUpper: number } {
  let lower = snapTick(tickLower, spacing);
  let upper = snapTick(tickUpper, spacing);
  if (lower >= upper) {
    upper = lower + spacing;
  }
  if (upper > MAX_TICK) {
    upper = snapTick(MAX_TICK, spacing);
    lower = upper - spacing;
  }
  return { tickLower: lower, tickUpper: upper };
}

/**
 * Symmetric percent width around `tickCurrent`.
 * widthPct=10 → roughly ±10% in price (token1/token0), then snapped.
 */
export function rangeFromWidthPct(
  tickCurrent: number,
  widthPct: number,
  spacing: number,
): { tickLower: number; tickUpper: number } {
  if (!(widthPct > 0) || widthPct >= 100) {
    throw new Error("widthPct must be in (0, 100)");
  }
  const ticksPerPct = Math.log(1.0001);
  const delta = Math.log(1 + widthPct / 100) / ticksPerPct;
  return snapRange(
    Math.floor(tickCurrent - delta),
    Math.ceil(tickCurrent + delta),
    spacing,
  );
}

/** Recenter a same-width range on `tickCurrent`. */
export function recenterSameWidth(
  tickLower: number,
  tickUpper: number,
  tickCurrent: number,
  spacing: number,
): { tickLower: number; tickUpper: number } {
  const width = tickUpper - tickLower;
  if (width <= 0) {
    throw new Error("invalid existing range width");
  }
  const half = Math.floor(width / 2);
  return snapRange(tickCurrent - half, tickCurrent - half + width, spacing);
}

export function priceToTick(price: number): number {
  if (!(price > 0)) throw new Error("price must be positive");
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

export function tickToPrice(tick: number): number {
  return Math.pow(1.0001, tick);
}

export function assertTickBounds(tick: number): void {
  if (tick < TickMath.MIN_TICK || tick > TickMath.MAX_TICK) {
    throw new Error(`tick ${tick} outside Uniswap bounds`);
  }
}
