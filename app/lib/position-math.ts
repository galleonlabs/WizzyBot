/**
 * Client-side pricing and tick math for the position surface. Every price is
 * expressed as "ETH per meme token" so the range reads the same way whether
 * ETH is token0 or token1 in the pool. Mirrors src/core/ticks.ts snapping.
 */
import { MAX_TICK, MIN_TICK, type PositionView } from "./cards";

const TICK_BASE = Math.log(1.0001);

export type Orientation = {
  /** null when neither side is ETH; prices then fall back to token1 per token0. */
  quoteIsToken0: boolean | null;
  memeSymbol: string;
  quoteSymbol: string;
};

export function isEthQuote(symbol: string): boolean {
  const upper = symbol.toUpperCase();
  return upper === "ETH" || upper === "WETH";
}

export function positionOrientation(view: Pick<PositionView, "symbol0" | "symbol1">): Orientation {
  const eth0 = isEthQuote(view.symbol0);
  const eth1 = isEthQuote(view.symbol1);
  if (eth0 === eth1) return { quoteIsToken0: null, memeSymbol: view.symbol0, quoteSymbol: view.symbol1 };
  return eth0
    ? { quoteIsToken0: true, memeSymbol: view.symbol1, quoteSymbol: view.symbol0 }
    : { quoteIsToken0: false, memeSymbol: view.symbol0, quoteSymbol: view.symbol1 };
}

/** Pool price (token1 per token0) at any tick, anchored on the live price at the current tick. */
export function poolPriceAtTick(view: Pick<PositionView, "price" | "tickCurrent">, tick: number): number {
  return view.price * Math.pow(1.0001, tick - view.tickCurrent);
}

/** ETH per meme token at a tick, inverting the pool quote when ETH is token0. */
export function memePriceAtTick(view: Pick<PositionView, "price" | "tickCurrent" | "symbol0" | "symbol1">, tick: number): number {
  const pool = poolPriceAtTick(view, tick);
  const { quoteIsToken0 } = positionOrientation(view);
  return quoteIsToken0 ? (pool > 0 ? 1 / pool : 0) : pool;
}

export function memePriceNow(view: Pick<PositionView, "price" | "tickCurrent" | "symbol0" | "symbol1">): number {
  return memePriceAtTick(view, view.tickCurrent);
}

/** Inverse of memePriceAtTick. Unsnapped. */
export function tickForMemePrice(view: Pick<PositionView, "price" | "tickCurrent" | "symbol0" | "symbol1">, memePrice: number): number {
  if (!(memePrice > 0) || !(view.price > 0)) throw new Error("price must be positive");
  const { quoteIsToken0 } = positionOrientation(view);
  const pool = quoteIsToken0 ? 1 / memePrice : memePrice;
  return view.tickCurrent + Math.log(pool / view.price) / TICK_BASE;
}

/** Range bounds as ETH per meme. Full range reads 0 → ∞. */
export function rangeBounds(view: Pick<PositionView, "price" | "tickCurrent" | "symbol0" | "symbol1" | "tickLower" | "tickUpper" | "fullRange">, ticks?: { tickLower: number; tickUpper: number }): { min: number; max: number | null } {
  if (view.fullRange && !ticks) return { min: 0, max: null };
  const lower = ticks?.tickLower ?? view.tickLower;
  const upper = ticks?.tickUpper ?? view.tickUpper;
  const { quoteIsToken0 } = positionOrientation(view);
  const a = memePriceAtTick(view, lower);
  const b = memePriceAtTick(view, upper);
  return quoteIsToken0 ? { min: b, max: a } : { min: a, max: b };
}

export function snapTick(tick: number, spacing: number): number {
  const minimum = Math.ceil(MIN_TICK / spacing) * spacing;
  const maximum = Math.floor(MAX_TICK / spacing) * spacing;
  return Math.max(minimum, Math.min(maximum, Math.round(tick / spacing) * spacing));
}

export function snapRange(tickLower: number, tickUpper: number, spacing: number): { tickLower: number; tickUpper: number } {
  let lower = snapTick(tickLower, spacing);
  let upper = snapTick(tickUpper, spacing);
  if (lower >= upper) upper = lower + spacing;
  if (upper > MAX_TICK) {
    upper = snapTick(MAX_TICK, spacing);
    lower = upper - spacing;
  }
  return { tickLower: lower, tickUpper: upper };
}

export function tickSpacingFor(view: Pick<PositionView, "tickSpacing" | "fee">): number {
  const spacing = view.tickSpacing ?? ({ 100: 1, 500: 10, 3000: 60, 10000: 200 } as Record<number, number>)[view.fee];
  if (!spacing) throw new Error("Range adjustment requires the pool tick spacing");
  return spacing;
}

/** Symmetric ±pct band around the live price, in price space, snapped to the pool. */
export function rangeFromPercent(view: Pick<PositionView, "tickCurrent" | "tickSpacing" | "fee">, pct: number): { tickLower: number; tickUpper: number } {
  if (!(pct > 0) || pct >= 100) throw new Error("pct must be in (0, 100)");
  const spacing = tickSpacingFor(view);
  const delta = Math.log(1 + pct / 100) / TICK_BASE;
  return snapRange(Math.floor(view.tickCurrent - delta), Math.ceil(view.tickCurrent + delta), spacing);
}

/** Same width as today, recentred on the live price. */
export function recenteredRange(view: Pick<PositionView, "tickCurrent" | "tickSpacing" | "fee" | "tickLower" | "tickUpper">): { tickLower: number; tickUpper: number } {
  const spacing = tickSpacingFor(view);
  const width = Math.max(spacing, view.tickUpper - view.tickLower);
  const half = Math.floor(width / 2);
  return snapRange(view.tickCurrent - half, view.tickCurrent - half + width, spacing);
}

/** Explicit min/max meme prices (ETH per meme) → snapped ticks, honouring pool orientation. */
export function rangeFromMemePrices(
  view: Pick<PositionView, "price" | "tickCurrent" | "symbol0" | "symbol1" | "tickSpacing" | "fee">,
  minPrice: number,
  maxPrice: number,
): { tickLower: number; tickUpper: number } {
  if (!(minPrice > 0) || !(maxPrice > minPrice)) throw new Error("The minimum price must be above zero and below the maximum");
  const spacing = tickSpacingFor(view);
  const a = tickForMemePrice(view, minPrice);
  const b = tickForMemePrice(view, maxPrice);
  return snapRange(Math.floor(Math.min(a, b)), Math.ceil(Math.max(a, b)), spacing);
}

/** Percent distance of the live price from the range midpoint, negative below. */
export function rangePosition(view: Pick<PositionView, "tickLower" | "tickUpper" | "tickCurrent">): number {
  const width = view.tickUpper - view.tickLower;
  if (width <= 0) return 0;
  return ((view.tickCurrent - view.tickLower) / width) * 100;
}

export type PortfolioSummary = {
  valueUsd: number;
  feesUsd: number;
  priced: number;
  inRange: number;
  total: number;
};

export function summarizePositions(positions: readonly Pick<PositionView, "positionUsd" | "feesUsd" | "status" | "closed">[]): PortfolioSummary {
  return positions.reduce<PortfolioSummary>((summary, position) => ({
    valueUsd: summary.valueUsd + (position.positionUsd ?? 0),
    feesUsd: summary.feesUsd + (position.feesUsd ?? 0),
    priced: summary.priced + (position.positionUsd !== undefined ? 1 : 0),
    inRange: summary.inRange + (position.status === "in-range" ? 1 : 0),
    total: summary.total + (position.closed ? 0 : 1),
  }), { valueUsd: 0, feesUsd: 0, priced: 0, inRange: 0, total: 0 });
}

/** ETH price implied by any ETH-side balance in the wallet's positions. */
export function impliedEthUsd(positions: readonly Pick<PositionView, "symbol0" | "symbol1" | "amount0" | "amount1" | "amount0Usd" | "amount1Usd">[]): number | undefined {
  for (const position of positions) {
    for (const side of [0, 1] as const) {
      const symbol = side === 0 ? position.symbol0 : position.symbol1;
      if (!isEthQuote(symbol)) continue;
      const amount = Number((side === 0 ? position.amount0 : position.amount1).replaceAll(",", ""));
      const usd = side === 0 ? position.amount0Usd : position.amount1Usd;
      if (amount > 0 && usd !== undefined && usd > 0) return usd / amount;
    }
  }
  return undefined;
}
