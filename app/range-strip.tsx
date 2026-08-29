"use client";

import type { PositionView } from "./lib/cards";
import { priceLabel } from "./lib/cards";

type RangeLike = Pick<
  PositionView,
  | "tickLower"
  | "tickUpper"
  | "tickCurrent"
  | "status"
  | "fullRange"
  | "price"
  | "priceMin"
  | "priceMax"
  | "kind"
>;

function pct(value: number, lo: number, hi: number): number {
  if (hi <= lo) return 50;
  return Math.min(100, Math.max(0, ((value - lo) / (hi - lo)) * 100));
}

function windowFor(live?: RangeLike, projected?: RangeLike): { lo: number; hi: number } {
  const ticks: number[] = [];
  for (const r of [live, projected]) {
    if (!r) continue;
    if (r.fullRange) {
      ticks.push(r.tickCurrent - 80_000, r.tickCurrent + 80_000);
    } else {
      ticks.push(r.tickLower, r.tickUpper, r.tickCurrent);
    }
  }
  if (ticks.length === 0) return { lo: -100, hi: 100 };
  const min = Math.min(...ticks);
  const max = Math.max(...ticks);
  const pad = Math.max(40, (max - min) * 0.18);
  return { lo: min - pad, hi: max + pad };
}

function tone(range?: RangeLike): "in" | "oor" | "closed" | "full" {
  if (!range) return "in";
  if (range.status === "closed") return "closed";
  if (range.fullRange) return "full";
  return range.status === "oor" ? "oor" : "in";
}

export function RangeStrip({
  live,
  projected,
  compact = false,
}: {
  live?: RangeLike;
  projected?: RangeLike;
  compact?: boolean;
}) {
  const primary = live ?? projected;
  if (!primary) return null;
  const { lo, hi } = windowFor(live, projected);
  const band = live ?? projected ?? primary;
  const left = pct(band.tickLower, lo, hi);
  const right = pct(band.tickUpper, lo, hi);
  const width = Math.max(2, right - left);
  const current = pct(primary.tickCurrent, lo, hi);
  const projLeft = projected ? pct(projected.tickLower, lo, hi) : 0;
  const projWidth = projected ? Math.max(2, pct(projected.tickUpper, lo, hi) - projLeft) : 0;
  const t = tone(live ?? projected);

  return (
    <div className={`strip ${compact ? "strip-compact" : ""}`} data-tone={t}>
      {!compact ? (
        <div className="strip-labels">
          <span>{live?.fullRange || projected?.fullRange ? "0" : priceLabel(primary.priceMin)}</span>
          <span>{priceLabel(primary.price)}</span>
          <span>{primary.fullRange ? "∞" : priceLabel(primary.priceMax, primary.priceMax === null)}</span>
        </div>
      ) : null}
      <div className="strip-track" aria-hidden="true">
        <i className="strip-band" style={{ left: `${left}%`, width: `${width}%` }} />
        {projected && live ? (
          <i className="strip-proj" style={{ left: `${projLeft}%`, width: `${projWidth}%` }} />
        ) : null}
        <i className="strip-current" style={{ left: `${current}%` }} />
      </div>
      {!compact ? (
        <div className="strip-caption">
          <span>
            min {primary.fullRange ? "0" : priceLabel(primary.priceMin)} · tick {primary.tickLower}
          </span>
          <span>current {priceLabel(primary.price)}</span>
          <span>
            max {primary.fullRange ? "∞" : priceLabel(primary.priceMax, primary.priceMax === null)} · tick{" "}
            {primary.tickUpper}
          </span>
        </div>
      ) : null}
    </div>
  );
}
