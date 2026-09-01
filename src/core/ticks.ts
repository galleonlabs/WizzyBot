import { nearestUsableTick, TickMath } from "@uniswap/v3-sdk";
import { FEE_AMOUNT_TICK_SPACING, MAX_TICK, MIN_TICK } from "../constants.js";

export type RangePreset = "focused" | "balanced" | "wide";

export const RANGE_PRESET_MULTIPLIER: Record<RangePreset, number> = {
  focused: 0.6,
  balanced: 1,
  wide: 1.8,
};

export function tickSpacingForFee(fee: number): number {
  const spacing = FEE_AMOUNT_TICK_SPACING[fee];
  if (spacing === undefined) {
    throw new Error(`Unsupported Uniswap v3 fee tier: ${fee}`);
  }
  return spacing;
}

/**
 * Uniswap's v3 SDK derives tick spacing from a fixed fee-tier table. Slipstream
 * has dynamic fees, so use the matching SDK fee solely for liquidity math.
 */
export function sdkFeeForTickSpacing(spacing: number): number {
  const fee = Object.entries(FEE_AMOUNT_TICK_SPACING).find(([, value]) => value === spacing)?.[0];
  if (fee === undefined) throw new Error(`Unsupported concentrated-liquidity tick spacing: ${spacing}`);
  return Number(fee);
}

export function snapTick(tick: number, spacing: number): number {
  if (!Number.isInteger(tick) || !Number.isInteger(spacing) || spacing <= 0) {
    throw new Error("tick must be an integer; spacing must be a positive integer");
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

/** Recenter a protocol-aligned range using a simple width preset. */
export function recenterRangeForPreset(
  tickLower: number,
  tickUpper: number,
  tickCurrent: number,
  spacing: number,
  preset: RangePreset,
): { tickLower: number; tickUpper: number } {
  const width = tickUpper - tickLower;
  if (width <= 0) throw new Error("invalid existing range width");
  if (!Number.isInteger(spacing) || spacing <= 0) throw new Error("spacing must be a positive integer");
  const intervals = Math.max(1, Math.round((width / spacing) * RANGE_PRESET_MULTIPLIER[preset]));
  const targetWidth = intervals * spacing;
  const half = Math.floor(targetWidth / 2);
  return snapRange(tickCurrent - half, tickCurrent - half + targetWidth, spacing);
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
