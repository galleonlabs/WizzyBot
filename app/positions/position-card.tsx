"use client";

import type { PositionView } from "../lib/cards";
import type { MarketStats, PositionActionKind } from "../lib/portfolio-types";
import { compactTokenAmount, ethValue, formatPercent, money } from "../lib/format";
import { positionFeesEth, positionValueEth, positionValueUsd } from "../lib/portfolio-summary";
import { positionOrientation } from "../lib/position-math";
import { CoinsIcon, ExitIcon, MinusIcon, PlusIcon, RangeIcon, TokenIcon } from "../ui/icons";
import { RangeChart } from "./range-chart";

export type PositionAbility = Record<PositionActionKind, boolean>;

export function positionAbilities(view: PositionView): PositionAbility {
  const concentrated = (view.protocol === "V3" || view.protocol === "V4") && view.chain !== "solana";
  const open = !view.closed;
  return {
    collect: open && view.protocol !== "V2" && hasCollectibleFees(view),
    compound: open && view.protocol !== "V2" && hasCollectibleFees(view),
    increase: open && (view.chain === "base" || view.chain === "robinhood"),
    decrease: open && view.protocol !== "V2",
    rebalance: open && concentrated && !view.fullRange,
    withdraw: open,
  };
}

export function hasCollectibleFees(view: PositionView): boolean {
  if ((view.feesUsd ?? 0) > 0) return true;
  return [view.uncollected0, view.uncollected1].some((amount) => Number(amount.replaceAll(",", "")) > 0);
}

export function venueLabel(view: PositionView): string {
  if (view.venue === "aerodrome-slipstream") return "Aerodrome Slipstream";
  if (view.protocol === "V2") return "Uniswap V2";
  if (view.protocol === "V3") return "Uniswap V3";
  if (view.protocol === "V4") return "Uniswap V4";
  return view.venueLabel ?? view.protocol;
}

export function positionValueLabel(view: PositionView): string {
  const usd = positionValueUsd(view);
  if (usd !== undefined && usd > 0) return money(usd);
  const eth = positionValueEth(view);
  return eth === undefined ? "—" : ethValue(eth);
}

export function positionFeesLabel(view: PositionView): string {
  if (view.feesUsd !== undefined && view.feesUsd > 0) return money(view.feesUsd);
  const eth = positionFeesEth(view);
  return eth === undefined ? "—" : ethValue(eth);
}

export function positionKey(view: PositionView): string {
  return `${view.chain}-${view.protocol}-${view.positionManager ?? "default"}-${view.tokenId}`;
}

const ACTIONS: Array<{ kind: PositionActionKind; label: string; icon: () => React.ReactElement }> = [
  { kind: "collect", label: "Collect", icon: CoinsIcon },
  { kind: "increase", label: "Add", icon: PlusIcon },
  { kind: "decrease", label: "Reduce", icon: MinusIcon },
  { kind: "rebalance", label: "Reposition", icon: RangeIcon },
  { kind: "withdraw", label: "Exit", icon: ExitIcon },
];

export function PositionCard({ view, ethUsd, stat, image, busy, onAction }: {
  view: PositionView;
  ethUsd?: number;
  stat?: MarketStats;
  image?: string | null;
  busy: boolean;
  onAction: (kind: PositionActionKind) => void;
}) {
  const abilities = positionAbilities(view);
  const { memeSymbol } = positionOrientation(view);
  const statusLabel = view.closed ? "Closed" : view.fullRange ? "Full range" : view.inRange ? "In range" : "Out of range";
  const statusClass = view.closed ? "is-closed" : view.inRange ? "is-in-range" : "is-oor";
  const poolApr = stat?.trailingFeeAprPct ?? null;
  const fees = hasCollectibleFees(view);
  return <article className={`lp-card ${statusClass}`} aria-label={`${view.pair} position`}>
    <header className="lp-head">
      <span className="lp-pair">
        <TokenIcon symbol={memeSymbol} src={image} size={40} />
        <span>
          <b>{view.symbol0} / {view.symbol1}</b>
          <small>{venueLabel(view)} · {view.feeLabel} · {view.chainLabel}{view.tokenId ? ` · #${view.tokenId}` : ""}</small>
        </span>
      </span>
      <span className={`lp-status ${statusClass}`}><i aria-hidden="true" />{statusLabel}</span>
    </header>
    <div className="lp-body">
      <dl className="lp-metrics">
        <div>
          <dt>Position value</dt>
          <dd>{positionValueLabel(view)}</dd>
          <span>{compactTokenAmount(view.amount0)} {view.symbol0} · {compactTokenAmount(view.amount1)} {view.symbol1}</span>
        </div>
        <div>
          <dt>Unclaimed fees</dt>
          <dd className={fees ? "positive" : ""}>{fees ? positionFeesLabel(view) : "—"}</dd>
          <span>{fees ? `${compactTokenAmount(view.uncollected0)} ${view.symbol0} · ${compactTokenAmount(view.uncollected1)} ${view.symbol1}` : "Nothing to collect yet"}</span>
        </div>
        <div>
          <dt>Pool fee APR</dt>
          <dd>{formatPercent(poolApr)}</dd>
          <span>{poolApr === null ? "Not tracked for this pool" : "Trailing 24h pool fees"}</span>
        </div>
      </dl>
      <RangeChart view={view} ethUsd={ethUsd} />
    </div>
    <footer className="lp-actions">
      {ACTIONS.map(({ kind, label, icon: Icon }) => (
        <button
          key={kind}
          type="button"
          data-kind={kind}
          className={kind === "withdraw" ? "is-exit" : ""}
          disabled={busy || !abilities[kind]}
          title={abilities[kind] ? undefined : disabledReason(view, kind)}
          onClick={() => onAction(kind)}
        >
          <Icon /><span>{label}</span>
        </button>
      ))}
    </footer>
  </article>;
}

function disabledReason(view: PositionView, kind: PositionActionKind): string {
  if (view.closed) return "This position is closed";
  if (kind === "collect" && view.protocol === "V2") return "V2 fees stay inside the LP token";
  if (kind === "collect") return "No fees to collect yet";
  if (kind === "decrease" && view.protocol === "V2") return "Partial removal is not available for V2";
  if (kind === "rebalance" && view.fullRange) return "Full-range positions have no range to move";
  if (kind === "rebalance") return "Repositioning needs a concentrated position";
  return "Not available for this position";
}
