/** Client-safe card types. Mirror src/core/view.ts. Do not import hosted or Uniswap SDK. */

export type Protocol = "V2" | "V3" | "V4" | "DLMM";
export type PositionKind = "live" | "projected";
export type RangeStatus = "in-range" | "oor" | "closed";
export type PositionVenue = "uniswap-v3" | "aerodrome-slipstream" | "meteora-dlmm";

export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
export type RangePreset = "focused" | "balanced" | "wide";

export type LiquidityProfile = {
  source: "live";
  protocol: "V3" | "V4";
  venue: "uniswap-v3" | "aerodrome-slipstream" | "uniswap-v4";
  tickCurrent: number;
  tickSpacing: number;
  tickLower: number;
  tickUpper: number;
  complete: boolean;
  notice?: string;
  bins: Array<{ tickLower: number; tickUpper: number; liquidity: string; height: number }>;
};

export const RANGE_PRESET_MULTIPLIER: Record<RangePreset, number> = {
  focused: 0.6,
  balanced: 1,
  wide: 1.8,
};

export type PositionView = {
  kind: PositionKind;
  protocol: Protocol;
  chain?: "base" | "robinhood" | "solana";
  chainLabel?: string;
  venue?: PositionVenue;
  venueLabel?: string;
  positionManager?: string;
  tokenId?: string;
  marketId?: string;
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
  tickSpacing?: number;
  percentThroughRange: number;
  price: number;
  priceMin: number | null;
  priceMax: number | null;
  symbol0: string;
  symbol1: string;
  amount0: string;
  amount1: string;
  uncollected0: string;
  uncollected1: string;
  amount0Usd?: number;
  amount1Usd?: number;
  positionUsd?: number;
  feesUsd?: number;
  lpUsd?: number;
  feeApr?: number;
  totalApr?: number;
  holdUsd?: number;
  divergence?: number;
  holdDeltaUsd?: number;
  holdDeltaPct?: number;
  ilUsd?: number;
  feesVsIlUsd?: number;
  pool?: string;
  owner?: string;
  holdNote?: string;
  liquidityProfile?: LiquidityProfile;
  address0?: string;
  address1?: string;
  decimals0?: number;
  decimals1?: number;
};

export type PositionRangeGeometry = {
  rangeStartPct: number;
  rangeEndPct: number;
  currentPct: number;
  currentState: "below" | "inside" | "above";
};

export type PositionRangePreview = {
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  currentPrice: number;
  priceMin: number;
  priceMax: number;
};

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

export function feeTierLabel(fee: number): string {
  if (!Number.isFinite(fee)) return "—";
  return `${(fee / 10_000).toFixed(2)}%`;
}

export function usd(n?: number | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

export function pct(n?: number | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(2)}%`;
}

export function priceLabel(n?: number | null, infinite?: boolean): string {
  if (infinite || n === null) return "∞";
  if (n === undefined || !Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toPrecision(4);
}

export function isFullRange(protocol: Protocol, tickLower: number, tickUpper: number): boolean {
  if (protocol === "V2") return true;
  if (protocol === "DLMM") return false;
  return tickLower <= MIN_TICK + 200 && tickUpper >= MAX_TICK - 200;
}

export function rangeStatus(view: Pick<PositionView, "closed" | "inRange">): RangeStatus {
  if (view.closed) return "closed";
  return view.inRange ? "in-range" : "oor";
}

export function statusLabel(status: RangeStatus): string {
  if (status === "in-range") return "in range";
  if (status === "oor") return "OOR";
  return "closed";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPositionView(value: unknown): value is PositionView {
  if (!isRecord(value)) return false;
  return (
    (value.kind === "live" || value.kind === "projected") &&
    typeof value.pair === "string" &&
    typeof value.protocol === "string" &&
    typeof value.tickLower === "number" &&
    typeof value.tickUpper === "number"
  );
}

export function isConfirmView(value: unknown): value is ConfirmView {
  if (!isRecord(value)) return false;
  return typeof value.action === "string" && typeof value.pair === "string" && typeof value.protocol === "string";
}

export function asProtocol(value: unknown): Protocol {
  if (value === "V2" || value === "V3" || value === "V4" || value === "DLMM") return value;
  if (typeof value === "string") {
    const up = value.toUpperCase();
    if (up === "V2" || up === "V3" || up === "V4" || up === "DLMM") return up;
  }
  return "V3";
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numOrNull(value: unknown): number | null | undefined {
  if (value === null) return null;
  return num(value);
}

export function lightRowToView(row: Record<string, unknown>): PositionView | null {
  if (isPositionView(row.view)) {
    return {
      ...row.view,
      marketId: typeof row.marketId === "string" ? row.marketId : row.view.marketId,
      liquidityProfile: asLiquidityProfile(row.liquidityProfile),
      address0: typeof row.address0 === "string" ? row.address0 : undefined,
      address1: typeof row.address1 === "string" ? row.address1 : undefined,
      decimals0: typeof row.decimals0 === "number" ? row.decimals0 : undefined,
      decimals1: typeof row.decimals1 === "number" ? row.decimals1 : undefined,
    };
  }
  if (typeof row.pair !== "string") return null;
  const fee = typeof row.fee === "number" ? row.fee : Number(row.fee ?? 0);
  const protocol = asProtocol(row.protocol);
  const tickLower = typeof row.tickLower === "number" ? row.tickLower : 0;
  const tickUpper = typeof row.tickUpper === "number" ? row.tickUpper : 0;
  const closed = row.closed === true;
  const inRange = row.inRange !== false && !closed;
  const fullRange = row.fullRange === true || isFullRange(protocol, tickLower, tickUpper);
  const positionUsd = num(row.positionUsd);
  const feesUsd = num(row.feesUsd);
  const holdUsd = num(row.holdUsd);
  const lpUsd = num(row.lpUsd) ?? (positionUsd !== undefined ? positionUsd + (feesUsd ?? 0) : undefined);
  const holdDeltaUsd =
    num(row.holdDeltaUsd) ?? (lpUsd !== undefined && holdUsd !== undefined ? lpUsd - holdUsd : undefined);
  return {
    kind: "live",
    protocol,
    chain: row.chain === "solana" ? "solana" : row.chain === "robinhood" ? "robinhood" : "base",
    chainLabel: typeof row.chainLabel === "string" ? row.chainLabel : (row.chain === "solana" ? "Solana" : row.chain === "robinhood" ? "Robinhood" : "Base"),
    venue: row.venue === "meteora-dlmm" ? "meteora-dlmm" : row.venue === "aerodrome-slipstream" ? "aerodrome-slipstream" : row.venue === "uniswap-v3" ? "uniswap-v3" : undefined,
    venueLabel: typeof row.venueLabel === "string" ? row.venueLabel : undefined,
    positionManager: typeof row.positionManager === "string" ? row.positionManager : undefined,
    tokenId: row.tokenId != null ? String(row.tokenId) : undefined,
    marketId: typeof row.marketId === "string" ? row.marketId : undefined,
    pair: row.pair,
    fee,
    feeLabel: typeof row.feeLabel === "string" ? row.feeLabel : feeTierLabel(fee),
    inRange,
    closed,
    fullRange,
    status: closed ? "closed" : inRange ? "in-range" : "oor",
    tickLower,
    tickUpper,
    tickCurrent: typeof row.tickCurrent === "number" ? row.tickCurrent : 0,
    tickSpacing: typeof row.tickSpacing === "number" ? row.tickSpacing : undefined,
    percentThroughRange: typeof row.percentThroughRange === "number" ? row.percentThroughRange : 50,
    price: typeof row.price === "number" ? row.price : 0,
    priceMin: numOrNull(row.priceMin) ?? (fullRange ? 0 : null),
    priceMax: numOrNull(row.priceMax) ?? null,
    symbol0: typeof row.symbol0 === "string" ? row.symbol0 : row.pair.split("/")[0] ?? "—",
    symbol1: typeof row.symbol1 === "string" ? row.symbol1 : row.pair.split("/")[1] ?? "—",
    amount0: typeof row.amount0 === "string" ? row.amount0 : "—",
    amount1: typeof row.amount1 === "string" ? row.amount1 : "—",
    uncollected0: typeof row.uncollected0 === "string" ? row.uncollected0 : "—",
    uncollected1: typeof row.uncollected1 === "string" ? row.uncollected1 : "—",
    amount0Usd: num(row.amount0Usd),
    amount1Usd: num(row.amount1Usd),
    positionUsd,
    feesUsd,
    lpUsd,
    feeApr: num(row.feeApr),
    totalApr: num(row.totalApr),
    holdUsd,
    divergence: num(row.divergence),
    holdDeltaUsd,
    holdDeltaPct: num(row.holdDeltaPct) ?? num(row.divergence),
    ilUsd: num(row.ilUsd),
    feesVsIlUsd: num(row.feesVsIlUsd) ?? holdDeltaUsd,
    liquidityProfile: asLiquidityProfile(row.liquidityProfile),
    address0: typeof row.address0 === "string" ? row.address0 : undefined,
    address1: typeof row.address1 === "string" ? row.address1 : undefined,
    decimals0: typeof row.decimals0 === "number" ? row.decimals0 : undefined,
    decimals1: typeof row.decimals1 === "number" ? row.decimals1 : undefined,
  };
}

function asLiquidityProfile(value: unknown): LiquidityProfile | undefined {
  if (!isRecord(value) || value.source !== "live" || !Array.isArray(value.bins)) return undefined;
  if (value.protocol !== "V3" && value.protocol !== "V4") return undefined;
  const venue = value.venue;
  if (venue !== "uniswap-v3" && venue !== "aerodrome-slipstream" && venue !== "uniswap-v4") return undefined;
  const bins = value.bins.flatMap((bin) => {
    if (!isRecord(bin) || typeof bin.tickLower !== "number" || typeof bin.tickUpper !== "number" || typeof bin.liquidity !== "string" || typeof bin.height !== "number") return [];
    return [{ tickLower: bin.tickLower, tickUpper: bin.tickUpper, liquidity: bin.liquidity, height: Math.max(0, Math.min(1, bin.height)) }];
  });
  if (!bins.length || typeof value.tickCurrent !== "number" || typeof value.tickSpacing !== "number" || typeof value.tickLower !== "number" || typeof value.tickUpper !== "number") return undefined;
  return {
    source: "live",
    protocol: value.protocol,
    venue,
    tickCurrent: value.tickCurrent,
    tickSpacing: value.tickSpacing,
    tickLower: value.tickLower,
    tickUpper: value.tickUpper,
    complete: value.complete === true,
    notice: typeof value.notice === "string" ? value.notice : undefined,
    bins,
  };
}

export function compositionShares(view: PositionView): { share0: number; share1: number } {
  const a = view.amount0Usd ?? 0;
  const b = view.amount1Usd ?? 0;
  const total = a + b;
  if (total <= 0) return { share0: 50, share1: 50 };
  return { share0: (a / total) * 100, share1: (b / total) * 100 };
}

/** Maps the position and current tick onto one honest logarithmic price axis. */
export function positionRangeGeometry(view: Pick<PositionView, "fullRange" | "tickLower" | "tickUpper" | "tickCurrent">): PositionRangeGeometry {
  if (view.fullRange) {
    return { rangeStartPct: 4, rangeEndPct: 96, currentPct: 50, currentState: "inside" };
  }
  const lower = Math.min(view.tickLower, view.tickUpper);
  const upper = Math.max(view.tickLower, view.tickUpper);
  const span = Math.max(1, upper - lower);
  const padding = span * 0.25;
  const domainMin = Math.min(lower, view.tickCurrent) - padding;
  const domainMax = Math.max(upper, view.tickCurrent) + padding;
  const toPercent = (tick: number) => Math.max(0, Math.min(100, (tick - domainMin) / (domainMax - domainMin) * 100));
  return {
    rangeStartPct: toPercent(lower),
    rangeEndPct: toPercent(upper),
    currentPct: toPercent(view.tickCurrent),
    currentState: view.tickCurrent < lower ? "below" : view.tickCurrent > upper ? "above" : "inside",
  };
}

export function positionRangePreview(
  view: Pick<PositionView, "fee" | "price" | "tickLower" | "tickUpper" | "tickCurrent" | "tickSpacing">,
  preset: RangePreset,
): PositionRangePreview {
  const spacing = view.tickSpacing ?? ({ 100: 1, 500: 10, 3000: 60, 10000: 200 } as Record<number, number>)[view.fee];
  if (!spacing) throw new Error("Range adjustment requires the pool tick spacing");
  const width = view.tickUpper - view.tickLower;
  const intervals = Math.max(1, Math.round((width / spacing) * RANGE_PRESET_MULTIPLIER[preset]));
  const targetWidth = intervals * spacing;
  const half = Math.floor(targetWidth / 2);
  let tickLower = nearestClientTick(view.tickCurrent - half, spacing);
  let tickUpper = nearestClientTick(view.tickCurrent - half + targetWidth, spacing);
  if (tickLower >= tickUpper) tickUpper = tickLower + spacing;
  if (tickUpper > MAX_TICK) {
    tickUpper = nearestClientTick(MAX_TICK, spacing);
    tickLower = tickUpper - spacing;
  }
  return positionRangePreviewForTicks(view, tickLower, tickUpper, view.tickCurrent);
}

export function positionRangePreviewForTicks(
  view: Pick<PositionView, "price" | "tickCurrent">,
  tickLower: number,
  tickUpper: number,
  currentTick: number,
): PositionRangePreview {
  const priceAt = (tick: number) => view.price * Math.pow(1.0001, tick - view.tickCurrent);
  return {
    tickLower,
    tickUpper,
    currentTick,
    currentPrice: priceAt(currentTick),
    priceMin: priceAt(tickLower),
    priceMax: priceAt(tickUpper),
  };
}

function nearestClientTick(tick: number, spacing: number): number {
  const minimum = Math.ceil(MIN_TICK / spacing) * spacing;
  const maximum = Math.floor(MAX_TICK / spacing) * spacing;
  return Math.max(minimum, Math.min(maximum, Math.round(tick / spacing) * spacing));
}
