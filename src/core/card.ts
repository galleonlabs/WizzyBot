import type { PositionCard, PositionSnapshot } from "../types.js";
import {
  ageDays,
  divergence,
  feeApr,
  feesUsd as feesUsdOf,
  holdUsd,
  lpUsd,
  positionNotionalUsd,
  totalApr,
  type HoldInput,
} from "./pnl.js";

export function buildCard(
  position: PositionSnapshot,
  prices: { price0Usd: number; price1Usd: number },
  hold: { hold0: bigint; hold1: bigint },
  createdAtSec?: number,
  nowSec?: number,
  holdMeta?: { source?: string; note?: string },
): PositionCard {
  const input: HoldInput = {
    hold0: hold.hold0,
    hold1: hold.hold1,
    amount0: position.amount0,
    amount1: position.amount1,
    uncollected0: position.uncollected0,
    uncollected1: position.uncollected1,
    price0Usd: prices.price0Usd,
    price1Usd: prices.price1Usd,
    decimals0: position.token0.decimals,
    decimals1: position.token1.decimals,
  };
  const age = ageDays(createdAtSec ?? position.createdAt ?? 0, nowSec);
  const notional = positionNotionalUsd(input);
  const fees = feesUsdOf(input);
  const holdValue = holdUsd(input);
  const lp = lpUsd(input);
  return {
    ...position,
    amount0Usd: notional - (notional && input.amount1 ? (Number(input.amount1) / 10 ** input.decimals1) * input.price1Usd : 0) ||
      (Number(input.amount0) / 10 ** input.decimals0) * input.price0Usd,
    amount1Usd: (Number(input.amount1) / 10 ** input.decimals1) * input.price1Usd,
    feesUsd: fees,
    positionUsd: notional,
    feeApr: feeApr({ feesUsd: fees, notionalUsd: notional, ageDays: age }),
    totalApr: totalApr({ lpUsd: lp, holdUsd: holdValue, ageDays: age }),
    holdUsd: holdValue,
    divergence: divergence(input),
    ageDays: age,
    holdSource: holdMeta?.source,
    holdNote: holdMeta?.note,
  };
}

export function formatCard(card: PositionCard): string {
  const pair = `${card.token0.symbol}/${card.token1.symbol}`;
  const range = `[${card.tickLower}, ${card.tickUpper})`;
  return [
    `tokenId ${card.ref.tokenId}  ${pair}  fee=${card.fee / 10_000}%  pool=${card.pool}`,
    `ticks ${range}  current=${card.tickCurrent}  inRange=${card.inRange}  through=${card.percentThroughRange.toFixed(1)}%`,
    `amounts ${fmt(card.amount0, card.token0)} + ${fmt(card.amount1, card.token1)}  ($${card.positionUsd.toFixed(2)})`,
    `uncollected ${fmt(card.uncollected0, card.token0)} + ${fmt(card.uncollected1, card.token1)}  ($${card.feesUsd.toFixed(2)})`,
    `fee APR ${pct(card.feeApr)}  total APR vs HOLD ${pct(card.totalApr)}  divergence ${pct(card.divergence)}`,
    `HOLD $${card.holdUsd.toFixed(2)}  age ${card.ageDays.toFixed(2)}d  liquidity ${card.liquidity}` +
      (card.holdSource ? `  source=${card.holdSource}` : ""),
    card.holdNote ? `HOLD note: ${card.holdNote}` : undefined,
  ].filter(Boolean).join("\n");
}

function fmt(raw: bigint, token: { symbol: string; decimals: number }): string {
  const n = Number(raw) / 10 ** token.decimals;
  return `${n.toPrecision(6)} ${token.symbol}`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}
