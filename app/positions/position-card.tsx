"use client";

import type { PositionView } from "../lib/cards";
import type { PositionActionKind } from "../lib/portfolio-types";
import { compactTokenAmount, ethValue, formatPercent, money } from "../lib/format";
import { managePositionUrl, venueLabelFor, type LinkVenue } from "../lib/links";
import { positionFeesEth, positionValueEth, positionValueUsd } from "../lib/portfolio-summary";
import { positionOrientation } from "../lib/position-math";
import { CoinsIcon, ExitIcon, ExternalLinkIcon, MinusIcon, PlusIcon, TokenIcon } from "../ui/icons";
import { RangeChart } from "./range-chart";

export type CardAction = PositionActionKind | "add";

/** Which actions run in-app (one transaction) and which hand off to the venue. */
export function positionAbilities(view: PositionView): Record<CardAction, "atomic" | "external" | "off"> {
  const open = !view.closed;
  const singleTx = open && (view.protocol === "V4" || (view.protocol === "V3" && view.venue !== "aerodrome-slipstream"));
  return {
    collect: open && view.protocol !== "V2" && hasCollectibleFees(view) ? "atomic" : "off",
    add: open && (view.chain === "base" || view.chain === "robinhood") ? "atomic" : "off",
    decrease: !open ? "off" : singleTx ? "atomic" : "external",
    withdraw: !open ? "off" : singleTx ? "atomic" : "external",
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

export function linkVenueOf(view: PositionView): LinkVenue {
  if (view.venue === "aerodrome-slipstream") return "aerodrome-slipstream";
  if (view.protocol === "V2") return "uniswap-v2";
  if (view.protocol === "V4") return "uniswap-v4";
  return "uniswap-v3";
}

export function manageUrl(view: PositionView): string {
  return managePositionUrl({ venue: linkVenueOf(view), chain: view.chain === "robinhood" ? "robinhood" : "base", tokenId: view.tokenId, pool: view.pool });
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

export function PositionCard({ view, ethUsd, poolApr, image, busy, onAction }: {
  view: PositionView;
  ethUsd?: number;
  poolApr?: number | null;
  image?: string | null;
  busy: boolean;
  onAction: (kind: CardAction) => void;
}) {
  const abilities = positionAbilities(view);
  const { memeSymbol } = positionOrientation(view);
  const statusLabel = view.closed ? "Closed" : view.fullRange ? "Full range" : view.inRange ? "In range" : "Out of range";
  const statusClass = view.closed ? "is-closed" : view.inRange ? "is-in-range" : "is-oor";
  const fees = hasCollectibleFees(view);
  const venue = venueLabelFor(linkVenueOf(view));
  const external = manageUrl(view);
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
          <dd>{formatPercent(poolApr ?? null)}</dd>
          <span>{poolApr == null ? "Not tracked for this pool" : "Trailing 24h pool fees"}</span>
        </div>
      </dl>
      <RangeChart view={view} ethUsd={ethUsd} />
    </div>
    <footer className="lp-actions">
      <button type="button" data-kind="collect" disabled={busy || abilities.collect !== "atomic"} title={abilities.collect === "atomic" ? "One transaction" : "No fees to collect yet"} onClick={() => onAction("collect")}><CoinsIcon /><span>Collect</span></button>
      <button type="button" data-kind="add" disabled={busy || abilities.add !== "atomic"} title="Swap into the pool tokens with Relay, then add on the venue" onClick={() => onAction("add")}><PlusIcon /><span>Add</span></button>
      <ActionButton kind="decrease" label="Reduce" icon={<MinusIcon />} mode={abilities.decrease} busy={busy} external={external} venue={venue} onClick={() => onAction("decrease")} />
      <ActionButton kind="withdraw" label="Exit" icon={<ExitIcon />} mode={abilities.withdraw} busy={busy} external={external} venue={venue} onClick={() => onAction("withdraw")} className="is-exit" />
      <a className="lp-manage" href={external} target="_blank" rel="noreferrer" title={`Reposition, migrate, or manage on ${venue}`}><ExternalLinkIcon /><span>{venue}</span></a>
    </footer>
  </article>;
}

function ActionButton({ kind, label, icon, mode, busy, external, venue, onClick, className = "" }: {
  kind: PositionActionKind;
  label: string;
  icon: React.ReactElement;
  mode: "atomic" | "external" | "off";
  busy: boolean;
  external: string;
  venue: string;
  onClick: () => void;
  className?: string;
}) {
  if (mode === "external") {
    return <a className={`lp-action-link ${className}`} data-kind={kind} href={external} target="_blank" rel="noreferrer" title={`This takes more than one transaction, so it happens on ${venue}`}>{icon}<span>{label}</span><ExternalLinkIcon /></a>;
  }
  return <button type="button" data-kind={kind} className={className} disabled={busy || mode === "off"} title={mode === "atomic" ? "One transaction" : "This position is closed"} onClick={onClick}>{icon}<span>{label}</span></button>;
}
