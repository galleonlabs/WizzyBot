"use client";

import type { CSSProperties } from "react";
import type { PositionView } from "../lib/cards";
import { formatPrice } from "../lib/format";
import { memePriceAtTick, positionOrientation, tickSpacingFor } from "../lib/position-math";

export type ProposedRange = { tickLower: number; tickUpper: number };

/**
 * One honest logarithmic price axis. Meme price always rises to the right,
 * so the chart reads the same whether ETH is token0 or token1 in the pool.
 */
export function RangeChart({ view, ethUsd, proposed, compact = false }: {
  view: PositionView;
  ethUsd?: number;
  proposed?: ProposedRange;
  compact?: boolean;
}) {
  const { quoteIsToken0, memeSymbol } = positionOrientation(view);
  const flip = quoteIsToken0 === true;
  const unit: "usd" | "eth" = ethUsd ? "usd" : "eth";
  const priceAt = (tick: number) => memePriceAtTick(view, tick) * (ethUsd ?? 1);
  let spacing = 1;
  try { spacing = tickSpacingFor(view); } catch { spacing = 1; }
  const anchors = view.fullRange
    ? [view.tickCurrent - 9_000, view.tickCurrent + 9_000]
    : [view.tickLower, view.tickUpper, view.tickCurrent, ...(proposed ? [proposed.tickLower, proposed.tickUpper] : [])];
  const lowest = Math.min(...anchors);
  const highest = Math.max(...anchors);
  const padding = Math.max(spacing * 6, (highest - lowest) * 0.24);
  const domainMin = lowest - padding;
  const domainMax = highest + padding;
  const at = (tick: number) => {
    const raw = Math.max(0, Math.min(1, (tick - domainMin) / (domainMax - domainMin)));
    return (flip ? 1 - raw : raw) * 100;
  };
  const band = (lower: number, upper: number) => {
    const a = at(lower);
    const b = at(upper);
    return { start: Math.min(a, b), width: Math.abs(b - a) };
  };
  const current = view.fullRange ? { start: 0, width: 100 } : band(view.tickLower, view.tickUpper);
  const next = proposed ? band(proposed.tickLower, proposed.tickUpper) : null;
  const pricePct = at(view.tickCurrent);
  const bins = view.liquidityProfile?.bins.filter((bin) => bin.tickUpper > domainMin && bin.tickLower < domainMax) ?? [];
  const bounds = view.fullRange && !proposed
    ? { min: 0, max: null }
    : (() => {
        const lo = priceAt(view.tickLower);
        const hi = priceAt(view.tickUpper);
        return { min: Math.min(lo, hi), max: Math.max(lo, hi) as number | null };
      })();
  const nextBounds = proposed ? (() => {
    const lo = priceAt(proposed.tickLower);
    const hi = priceAt(proposed.tickUpper);
    return { min: Math.min(lo, hi), max: Math.max(lo, hi) };
  })() : null;
  const priceLabel = formatPrice(priceAt(view.tickCurrent), unit);
  const statusClass = view.closed ? "is-closed" : view.inRange ? "is-in-range" : "is-oor";
  const labelSide = pricePct > 82 ? "is-left" : pricePct < 18 ? "is-right" : "";

  return <div className={`range-chart ${statusClass} ${compact ? "is-compact" : ""} ${proposed ? "has-proposal" : ""}`} aria-label={`${memeSymbol} price ${priceLabel}. Range ${formatPrice(bounds.min, unit)} to ${formatPrice(bounds.max, unit)}.${nextBounds ? ` New range ${formatPrice(nextBounds.min, unit)} to ${formatPrice(nextBounds.max, unit)}.` : ""}`}>
    <div className="range-chart-canvas" style={{ "--price-x": `${pricePct}%` } as CSSProperties}>
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
        {bins.map((bin) => {
          const geometry = band(Math.max(domainMin, bin.tickLower), Math.min(domainMax, bin.tickUpper));
          const height = Math.max(2, bin.height * 86);
          return <rect className="range-chart-bin" key={`${bin.tickLower}:${bin.tickUpper}`} x={geometry.start * 10} y={100 - height} width={Math.max(2.5, geometry.width * 10)} height={height} />;
        })}
        <rect className="range-chart-band is-current" x={current.start * 10} y={0} width={Math.max(4, current.width * 10)} height={100} />
        {next ? <rect className="range-chart-band is-next" x={next.start * 10} y={0} width={Math.max(4, next.width * 10)} height={100} /> : null}
      </svg>
      <span className="range-chart-edge is-start" style={{ left: `${current.start}%` }} aria-hidden="true" />
      <span className="range-chart-edge is-end" style={{ left: `${current.start + current.width}%` }} aria-hidden="true" />
      {next ? <>
        <span className="range-chart-edge is-next is-start" style={{ left: `${next.start}%` }} aria-hidden="true" />
        <span className="range-chart-edge is-next is-end" style={{ left: `${next.start + next.width}%` }} aria-hidden="true" />
      </> : null}
      <span className="range-chart-price" aria-hidden="true"><i /><b className={labelSide}>{priceLabel}</b></span>
    </div>
    <div className="range-chart-labels" aria-hidden="true">
      <span style={{ left: `${current.start}%` }} className={current.start > 60 ? "is-flipped" : ""}><small>Min</small><b>{formatPrice(bounds.min, unit)}</b></span>
      <span style={{ left: `${current.start + current.width}%` }} className={current.start + current.width < 40 ? "" : "is-flipped"}><small>Max</small><b>{formatPrice(bounds.max, unit)}</b></span>
    </div>
    {next && nextBounds ? <div className="range-chart-labels is-next" aria-hidden="true">
      <span style={{ left: `${next.start}%` }} className={next.start > 60 ? "is-flipped" : ""}><small>New min</small><b>{formatPrice(nextBounds.min, unit)}</b></span>
      <span style={{ left: `${next.start + next.width}%` }} className={next.start + next.width < 40 ? "" : "is-flipped"}><small>New max</small><b>{formatPrice(nextBounds.max, unit)}</b></span>
    </div> : null}
  </div>;
}
