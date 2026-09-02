"use client";

import type { PositionView } from "../lib/cards";
import { formatPrice } from "../lib/format";
import { memePriceAtTick, positionOrientation, tickSpacingFor } from "../lib/position-math";

/**
 * A slim range strip for table rows: the position's band on one logarithmic
 * price axis with the live price marker. Meme price rises to the right
 * whether ETH is token0 or token1.
 */
export function RangeStrip({ view, ethUsd }: { view: PositionView; ethUsd?: number }) {
  const { quoteIsToken0 } = positionOrientation(view);
  const flip = quoteIsToken0 === true;
  const unit: "usd" | "eth" = ethUsd ? "usd" : "eth";
  const priceAt = (tick: number) => memePriceAtTick(view, tick) * (ethUsd ?? 1);
  let spacing = 1;
  try { spacing = tickSpacingFor(view); } catch { spacing = 1; }
  const anchors = view.fullRange ? [view.tickCurrent - 9_000, view.tickCurrent + 9_000] : [view.tickLower, view.tickUpper, view.tickCurrent];
  const lowest = Math.min(...anchors);
  const highest = Math.max(...anchors);
  const padding = Math.max(spacing * 6, (highest - lowest) * 0.22);
  const domainMin = lowest - padding;
  const domainMax = highest + padding;
  const at = (tick: number) => {
    const raw = Math.max(0, Math.min(1, (tick - domainMin) / (domainMax - domainMin)));
    return (flip ? 1 - raw : raw) * 100;
  };
  const a = at(view.tickLower);
  const b = at(view.tickUpper);
  const band = view.fullRange ? { start: 0, width: 100 } : { start: Math.min(a, b), width: Math.abs(b - a) };
  const pricePct = at(view.tickCurrent);
  const lo = priceAt(view.tickLower);
  const hi = priceAt(view.tickUpper);
  const bounds = view.fullRange ? { min: 0, max: null as number | null } : { min: Math.min(lo, hi), max: Math.max(lo, hi) as number | null };
  const status = view.closed ? "is-closed" : view.inRange ? "is-in-range" : "is-oor";
  const statusLabel = view.closed ? "Closed" : view.fullRange ? "Full range" : view.inRange ? "In range" : "Out of range";
  return <div className={`range-strip ${status}`} aria-label={`${statusLabel}. Price ${formatPrice(priceAt(view.tickCurrent), unit)}, range ${formatPrice(bounds.min, unit)} to ${formatPrice(bounds.max, unit)}.`}>
    <span className="range-strip-track" aria-hidden="true">
      <i className="range-strip-band" style={{ left: `${band.start}%`, width: `${Math.max(1.5, band.width)}%` }} />
      <i className="range-strip-price" style={{ left: `${pricePct}%` }} />
    </span>
    <span className="range-strip-labels" aria-hidden="true">
      <small>{formatPrice(bounds.min, unit)}</small>
      <b className={`range-strip-status ${status}`}><i />{statusLabel}</b>
      <small>{formatPrice(bounds.max, unit)}</small>
    </span>
  </div>;
}
