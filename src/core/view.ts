import type { ActionReceipt, PositionCard, PositionSnapshot, Protocol } from "../types.js";
import { labelForChainId, slugForChainId, type ChainSlug } from "../chains.js";
import { percentThroughRange } from "./range.js";

/** JSON card the hosted UI panel renders. No bigint. No SDK types. */
export type PositionKind = "live" | "projected";
export type RangeStatus = "in-range" | "oor" | "closed";

/** Uniswap v3 tick bounds. Duplicated so this file stays SDK-free. */
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

export type PositionView = {
  kind: PositionKind;
  protocol: Protocol;
  chain: ChainSlug;
  chainLabel: string;
  tokenId?: string;
  pair: string;
  fee: number;
  feeLabel: string;
  inRange: boolean;
  closed: boolean;
  fullRange: boolean;
  status: RangeStatus;
  tickLower: number;
  tickUpper: number;
  tickCurrent: number;
  percentThroughRange: number;
  price: number;
  /** null = 0 (full-range display). */
  priceMin: number | null;
  /** null = ∞ (full-range display). */
  priceMax: number | null;
  symbol0: string;
  symbol1: string;
  amount0: string;
  amount1: string;
  uncollected0: string;
  uncollected1: string;
  amount0Usd?: number;
  amount1Usd?: number;
  /** Current principal in the pool (no uncollected). */
  positionUsd?: number;
  feesUsd?: number;
  /** principal + uncollected */
  lpUsd?: number;
  feeApr?: number;
  totalApr?: number;
  holdUsd?: number;
  divergence?: number;
  holdDeltaUsd?: number;
  holdDeltaPct?: number;
  /** principal − HOLD (negative = IL). */
  ilUsd?: number;
  /** fees + IL = same as hold Δ. */
  feesVsIlUsd?: number;
  pool?: string;
  owner?: string;
  holdNote?: string;
};

export function isFullRange(protocol: Protocol, tickLower: number, tickUpper: number): boolean {
  if (protocol === "V2") return true;
  return tickLower <= MIN_TICK + 200 && tickUpper >= MAX_TICK - 200;
}

export function holdEconomics(input: { positionUsd?: number; feesUsd?: number; holdUsd?: number }): {
  lpUsd?: number;
  holdDeltaUsd?: number;
  holdDeltaPct?: number;
  ilUsd?: number;
  feesVsIlUsd?: number;
} {
  const principal = input.positionUsd;
  const fees = input.feesUsd ?? 0;
  if (principal === undefined) return {};
  const lpUsd = principal + fees;
  const hold = input.holdUsd;
  if (hold === undefined) return { lpUsd };
  const holdDeltaUsd = lpUsd - hold;
  const holdDeltaPct = hold === 0 ? 0 : holdDeltaUsd / hold;
  const ilUsd = principal - hold;
  return { lpUsd, holdDeltaUsd, holdDeltaPct, ilUsd, feesVsIlUsd: fees + ilUsd };
}

export function finishView(
  view: Omit<PositionView, "status" | "fullRange" | "priceMin" | "priceMax" | "lpUsd" | "holdDeltaUsd" | "holdDeltaPct" | "ilUsd" | "feesVsIlUsd"> &
    Partial<Pick<PositionView, "status" | "fullRange" | "priceMin" | "priceMax" | "lpUsd" | "closed">>,
  decimals0: number,
  decimals1: number,
): PositionView {
  const fullRange = view.fullRange ?? isFullRange(view.protocol, view.tickLower, view.tickUpper);
  const closed = Boolean(view.closed);
  const status: RangeStatus = closed ? "closed" : view.inRange ? "in-range" : "oor";
  const econ = holdEconomics(view);
  return {
    ...view,
    ...econ,
    closed,
    fullRange,
    status,
    priceMin: fullRange ? 0 : priceFromTick(view.tickLower, decimals0, decimals1),
    priceMax: fullRange ? null : priceFromTick(view.tickUpper, decimals0, decimals1),
  };
}

export type ConfirmView = {
  action: string;
  protocol: Protocol;
  pair: string;
  fee: number;
  feeLabel: string;
  tokenId?: string;
  tickLower?: number;
  tickUpper?: number;
  tickCurrent?: number;
  amount0?: string;
  amount1?: string;
  symbol0: string;
  symbol1: string;
  feesUsd?: number;
  gasUsd?: number;
  protocolFeeUsd?: number;
  protocolFeeBps?: number;
  protocolFeeSource?: string;
  dryRun: boolean;
  skipped: boolean;
  reason?: string;
};

export type MintQuoteLike = {
  chainId?: number;
  protocol: Protocol;
  symbol0: string;
  symbol1: string;
  decimals0: number;
  decimals1: number;
  fee: number;
  pool: string;
  tickCurrent: number;
  tickLower: number;
  tickUpper: number;
  sqrtPriceX96: bigint;
  amount0: bigint;
  amount1: bigint;
};

export function feeTierLabel(fee: number): string {
  if (!Number.isFinite(fee)) return "—";
  return `${(fee / 10_000).toFixed(2)}%`;
}

export function formatTokenAmount(raw: bigint, decimals: number): string {
  if (raw === 0n) return "0";
  const n = Number(raw) / 10 ** decimals;
  if (!Number.isFinite(n)) return raw.toString();
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (Math.abs(n) >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toPrecision(4);
}

/** token1 per token0, adjusted for decimals. Does not import ticks.ts (v3-sdk). */
export function priceFromTick(tick: number, decimals0: number, decimals1: number): number {
  return Math.pow(1.0001, tick) * 10 ** (decimals0 - decimals1);
}

export function priceFromSqrtX96(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  const sqrt = Number(sqrtPriceX96) / 2 ** 96;
  if (!Number.isFinite(sqrt) || sqrt <= 0) return 0;
  return sqrt * sqrt * 10 ** (decimals0 - decimals1);
}

function snapshotPrice(sqrtPriceX96: bigint, tick: number, decimals0: number, decimals1: number): number {
  return sqrtPriceX96 > 0n
    ? priceFromSqrtX96(sqrtPriceX96, decimals0, decimals1)
    : priceFromTick(tick, decimals0, decimals1);
}

export function serializeLiveView(card: PositionCard): PositionView {
  return finishView(
    {
      kind: "live",
      protocol: card.ref.protocol,
      chain: slugForChainId(card.ref.chainId),
      chainLabel: labelForChainId(card.ref.chainId),
      tokenId: card.ref.tokenId.toString(),
      pair: `${card.token0.symbol}/${card.token1.symbol}`,
      fee: card.fee,
      feeLabel: feeTierLabel(card.fee),
      inRange: card.inRange,
      closed: card.liquidity === 0n,
      tickLower: card.tickLower,
      tickUpper: card.tickUpper,
      tickCurrent: card.tickCurrent,
      percentThroughRange: card.percentThroughRange,
      price: snapshotPrice(card.sqrtPriceX96, card.tickCurrent, card.token0.decimals, card.token1.decimals),
      symbol0: card.token0.symbol,
      symbol1: card.token1.symbol,
      amount0: formatTokenAmount(card.amount0, card.token0.decimals),
      amount1: formatTokenAmount(card.amount1, card.token1.decimals),
      uncollected0: formatTokenAmount(card.uncollected0, card.token0.decimals),
      uncollected1: formatTokenAmount(card.uncollected1, card.token1.decimals),
      amount0Usd: card.amount0Usd,
      amount1Usd: card.amount1Usd,
      positionUsd: card.positionUsd,
      feesUsd: card.feesUsd,
      feeApr: card.feeApr,
      totalApr: card.totalApr,
      holdUsd: card.holdUsd,
      divergence: card.divergence,
      pool: card.pool,
      owner: card.owner,
      holdNote: card.holdNote,
    },
    card.token0.decimals,
    card.token1.decimals,
  );
}

export function serializeMintView(quote: MintQuoteLike): PositionView {
  const through = percentThroughRange(quote.tickCurrent, quote.tickLower, quote.tickUpper);
  const inRange = quote.tickCurrent >= quote.tickLower && quote.tickCurrent < quote.tickUpper;
  return finishView(
    {
      kind: "projected",
      protocol: quote.protocol,
      chain: slugForChainId(quote.chainId ?? 8453),
      chainLabel: labelForChainId(quote.chainId ?? 8453),
      pair: `${quote.symbol0}/${quote.symbol1}`,
      fee: quote.fee,
      feeLabel: feeTierLabel(quote.fee),
      inRange,
      closed: false,
      tickLower: quote.tickLower,
      tickUpper: quote.tickUpper,
      tickCurrent: quote.tickCurrent,
      percentThroughRange: through,
      price: snapshotPrice(quote.sqrtPriceX96, quote.tickCurrent, quote.decimals0, quote.decimals1),
      symbol0: quote.symbol0,
      symbol1: quote.symbol1,
      amount0: formatTokenAmount(quote.amount0, quote.decimals0),
      amount1: formatTokenAmount(quote.amount1, quote.decimals1),
      uncollected0: "0",
      uncollected1: "0",
      pool: quote.pool,
    },
    quote.decimals0,
    quote.decimals1,
  );
}

export function serializeProjectedRange(
  snap: PositionSnapshot,
  next: { tickLower: number; tickUpper: number },
): PositionView {
  const through = percentThroughRange(snap.tickCurrent, next.tickLower, next.tickUpper);
  const inRange = snap.tickCurrent >= next.tickLower && snap.tickCurrent < next.tickUpper;
  return finishView(
    {
      kind: "projected",
      protocol: snap.ref.protocol,
      chain: slugForChainId(snap.ref.chainId),
      chainLabel: labelForChainId(snap.ref.chainId),
      tokenId: snap.ref.tokenId.toString(),
      pair: `${snap.token0.symbol}/${snap.token1.symbol}`,
      fee: snap.fee,
      feeLabel: feeTierLabel(snap.fee),
      inRange,
      closed: false,
      tickLower: next.tickLower,
      tickUpper: next.tickUpper,
      tickCurrent: snap.tickCurrent,
      percentThroughRange: through,
      price: snapshotPrice(snap.sqrtPriceX96, snap.tickCurrent, snap.token0.decimals, snap.token1.decimals),
      symbol0: snap.token0.symbol,
      symbol1: snap.token1.symbol,
      amount0: formatTokenAmount(snap.amount0, snap.token0.decimals),
      amount1: formatTokenAmount(snap.amount1, snap.token1.decimals),
      uncollected0: formatTokenAmount(snap.uncollected0, snap.token0.decimals),
      uncollected1: formatTokenAmount(snap.uncollected1, snap.token1.decimals),
      pool: snap.pool,
      owner: snap.owner,
    },
    snap.token0.decimals,
    snap.token1.decimals,
  );
}

export function serializeConfirm(input: {
  action: string;
  protocol: Protocol;
  pair: string;
  fee: number;
  symbol0: string;
  symbol1: string;
  tokenId?: string;
  tickLower?: number;
  tickUpper?: number;
  tickCurrent?: number;
  amount0?: string;
  amount1?: string;
  feesUsd?: number;
  gasUsd?: number;
  protocolFeeUsd?: number;
  protocolFeeBps?: number;
  protocolFeeSource?: string;
  dryRun: boolean;
  skipped?: boolean;
  reason?: string;
}): ConfirmView {
  return {
    action: input.action,
    protocol: input.protocol,
    pair: input.pair,
    fee: input.fee,
    feeLabel: feeTierLabel(input.fee),
    tokenId: input.tokenId,
    tickLower: input.tickLower,
    tickUpper: input.tickUpper,
    tickCurrent: input.tickCurrent,
    amount0: input.amount0,
    amount1: input.amount1,
    symbol0: input.symbol0,
    symbol1: input.symbol1,
    feesUsd: input.feesUsd,
    gasUsd: input.gasUsd,
    protocolFeeUsd: input.protocolFeeUsd,
    protocolFeeBps: input.protocolFeeBps,
    protocolFeeSource: input.protocolFeeSource,
    dryRun: input.dryRun,
    skipped: Boolean(input.skipped),
    reason: input.reason,
  };
}

export function confirmFromPosition(
  action: string,
  snap: PositionSnapshot,
  receipt: ActionReceipt,
  extras: { feesUsd?: number; gasUsd?: number; projection?: PositionView } = {},
): ConfirmView {
  const projected = extras.projection;
  const fee = receipt.treasuryFee;
  return serializeConfirm({
    action,
    protocol: snap.ref.protocol,
    pair: `${snap.token0.symbol}/${snap.token1.symbol}`,
    fee: snap.fee,
    symbol0: snap.token0.symbol,
    symbol1: snap.token1.symbol,
    tokenId: snap.ref.tokenId.toString(),
    tickLower: projected?.tickLower ?? snap.tickLower,
    tickUpper: projected?.tickUpper ?? snap.tickUpper,
    tickCurrent: snap.tickCurrent,
    amount0: formatTokenAmount(snap.amount0, snap.token0.decimals),
    amount1: formatTokenAmount(snap.amount1, snap.token1.decimals),
    feesUsd: extras.feesUsd,
    gasUsd: extras.gasUsd ?? 0.15,
    protocolFeeUsd: fee && !fee.skipped ? fee.usd : fee?.skipped ? 0 : undefined,
    protocolFeeBps: fee && !fee.skipped ? fee.bps : fee?.skipped ? 0 : undefined,
    protocolFeeSource: fee?.source,
    dryRun: receipt.dryRun,
    skipped: receipt.skipped,
    reason: receipt.reason,
  });
}

export function confirmFromMint(quote: MintQuoteLike, receipt: ActionReceipt, gasUsd = 0.15): ConfirmView {
  return serializeConfirm({
    action: "mint",
    protocol: quote.protocol,
    pair: `${quote.symbol0}/${quote.symbol1}`,
    fee: quote.fee,
    symbol0: quote.symbol0,
    symbol1: quote.symbol1,
    tickLower: quote.tickLower,
    tickUpper: quote.tickUpper,
    tickCurrent: quote.tickCurrent,
    amount0: formatTokenAmount(quote.amount0, quote.decimals0),
    amount1: formatTokenAmount(quote.amount1, quote.decimals1),
    gasUsd,
    protocolFeeUsd: 0,
    protocolFeeBps: 0,
    dryRun: receipt.dryRun,
    skipped: receipt.skipped,
    reason: receipt.reason,
  });
}

export function isPositionView(value: unknown): value is PositionView {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.kind === "live" || v.kind === "projected") &&
    typeof v.pair === "string" &&
    typeof v.protocol === "string" &&
    typeof v.tickLower === "number" &&
    typeof v.tickUpper === "number"
  );
}

export function isConfirmView(value: unknown): value is ConfirmView {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.action === "string" && typeof v.pair === "string" && typeof v.protocol === "string";
}

/** Shape a hosted list/status payload into the API envelope the panel fetches. */
export function positionsApiPayload(input: {
  owner?: string;
  positions?: unknown[];
  error?: string;
}): { owner?: string; count: number; positions: unknown[]; error?: string } {
  const positions = Array.isArray(input.positions) ? input.positions : [];
  return {
    owner: input.owner,
    count: positions.length,
    positions,
    error: input.error,
  };
}
