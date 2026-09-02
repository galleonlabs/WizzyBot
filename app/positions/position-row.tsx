"use client";

import type { PositionView } from "../lib/cards";
import type { PositionActionKind } from "../lib/portfolio-types";
import { compactTokenAmount, ethValue, formatPercent, money } from "../lib/format";
import { managePositionUrl, venueLabelFor, type LinkVenue } from "../lib/links";
import { positionFeesEth, positionValueEth, positionValueUsd } from "../lib/portfolio-summary";
import { positionOrientation } from "../lib/position-math";
import { BrandLogo, CoinsIcon, ExitIcon, ExternalLinkIcon, MinusIcon, PlusIcon, TokenIcon } from "../ui/icons";
import { RangeStrip } from "./range-chart";

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

export function PositionRow({ view, ethUsd, poolApr, image, busy, onAction }: {
  view: PositionView;
  ethUsd?: number;
  poolApr?: number | null;
  image?: string | null;
  busy: boolean;
  onAction: (kind: CardAction) => void;
}) {
  const abilities = positionAbilities(view);
  const { memeSymbol } = positionOrientation(view);
  const fees = hasCollectibleFees(view);
  const venue = venueLabelFor(linkVenueOf(view));
  const external = manageUrl(view);
  const chain = view.chain === "robinhood" ? "robinhood" : "base";
  return <tr className={`position-row ${view.closed ? "is-closed" : view.inRange ? "is-in-range" : "is-oor"}`}>
    <td>
      <span className="pair-cell">
        <TokenIcon symbol={memeSymbol} src={image} />
        <span>
          <b>{view.symbol0} / {view.symbol1}<small className="pool-fee"> {view.feeLabel}</small></b>
          <span className="venue-trail"><BrandLogo brand={chain} label={view.chainLabel ?? chain} compact /><span>{view.chainLabel}</span><i>{venueLabel(view)}{view.tokenId ? ` · #${view.tokenId}` : ""}</i></span>
        </span>
      </span>
    </td>
    <td>
      <span className="cell-stack">
        <b>{positionValueLabel(view)}</b>
        <small>{compactTokenAmount(view.amount0)} {view.symbol0} · {compactTokenAmount(view.amount1)} {view.symbol1}</small>
      </span>
    </td>
    <td>
      <span className="cell-stack">
        <b className={fees ? "positive" : "muted"}>{fees ? positionFeesLabel(view) : "—"}</b>
        <small>{fees ? `${compactTokenAmount(view.uncollected0)} ${view.symbol0} · ${compactTokenAmount(view.uncollected1)} ${view.symbol1}` : "Nothing to collect"}</small>
      </span>
    </td>
    <td><RangeStrip view={view} ethUsd={ethUsd} /></td>
    <td><b className={poolApr == null ? "muted" : "fee-apr"}>{formatPercent(poolApr ?? null)}</b></td>
    <td>
      <span className="row-actions">
        <RowAction kind="collect" tip={abilities.collect === "atomic" ? "Collect fees · one transaction" : "No fees to collect yet"} mode={abilities.collect} busy={busy} onClick={() => onAction("collect")} icon={<CoinsIcon />} className="is-collect" />
        <RowAction kind="add" tip="Add liquidity · Relay swaps you into the pool tokens, then you add on the venue" mode={abilities.add} busy={busy} onClick={() => onAction("add")} icon={<PlusIcon />} />
        <RowAction kind="decrease" tip={abilities.decrease === "external" ? `Reduce on ${venue} · takes more than one transaction` : "Reduce · one transaction"} mode={abilities.decrease} busy={busy} onClick={() => onAction("decrease")} icon={<MinusIcon />} external={external} />
        <RowAction kind="withdraw" tip={abilities.withdraw === "external" ? `Exit on ${venue} · takes more than one transaction` : "Exit · one transaction, then sell to ETH with Relay"} mode={abilities.withdraw} busy={busy} onClick={() => onAction("withdraw")} icon={<ExitIcon />} external={external} className="is-exit" />
        <a className="row-action tip is-end" data-tip={`Open on ${venue} · reposition, migrate, manage`} aria-label={`Open on ${venue}`} href={external} target="_blank" rel="noreferrer"><ExternalLinkIcon /></a>
      </span>
    </td>
  </tr>;
}

function RowAction({ kind, tip, mode, busy, onClick, icon, external, className = "" }: {
  kind: CardAction;
  tip: string;
  mode: "atomic" | "external" | "off";
  busy: boolean;
  onClick: () => void;
  icon: React.ReactElement;
  external?: string;
  className?: string;
}) {
  if (mode === "external" && external) {
    return <a className={`row-action tip ${className}`} data-kind={kind} data-tip={tip} aria-label={tip} href={external} target="_blank" rel="noreferrer">{icon}</a>;
  }
  return <button type="button" className={`row-action tip ${className}`} data-kind={kind} data-tip={tip} aria-label={tip} disabled={busy || mode === "off"} onClick={onClick}>{icon}</button>;
}
