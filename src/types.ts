import type { Address, Hash, Hex } from "viem";

export type Protocol = "V2" | "V3" | "V4";

export type FeeSource = "fees" | "notional";

export type ActionKind =
  | "collect"
  | "swap"
  | "increase"
  | "decrease"
  | "mint"
  | "burn"
  | "transfer"
  | "approve"
  | "unwrap"
  | "wrap";

export interface PositionRef {
  protocol: Protocol;
  chainId: number;
  tokenId: bigint;
}

export interface TickRange {
  tickLower: number;
  tickUpper: number;
}

export interface TokenRef {
  address: Address;
  symbol: string;
  decimals: number;
}

export interface Amounts {
  amount0: bigint;
  amount1: bigint;
}

export interface PlannedTx {
  to: Address;
  data: Hex;
  value: bigint;
  description: string;
}

export interface PlannedAction {
  kind: ActionKind;
  description: string;
  tokenIn?: Address;
  tokenOut?: Address;
  amountIn?: bigint;
  amountOut?: bigint;
  recipient?: Address;
  tx?: PlannedTx;
}

export interface TreasuryFee {
  source: FeeSource;
  bps: number;
  skipped: boolean;
  recipient: Address;
  token0: Address;
  token1: Address;
  amount0: bigint;
  amount1: bigint;
  usd?: number;
}

export interface ActionReceipt {
  action: "compound" | "rerange" | "exit" | "mint" | "increase" | "decrease" | "claim" | "simulate";
  dryRun: boolean;
  skipped: boolean;
  reason?: string;
  tokenId?: bigint;
  newTokenId?: bigint;
  from: Address;
  to: Address[];
  actions: PlannedAction[];
  treasuryFee: TreasuryFee | null;
  txs: PlannedTx[];
  hash?: Hash;
}

export interface PositionSnapshot {
  ref: PositionRef;
  owner: Address;
  token0: TokenRef;
  token1: TokenRef;
  fee: number;
  tickSpacing: number;
  tickLower: number;
  tickUpper: number;
  tickCurrent: number;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
  uncollected0: bigint;
  uncollected1: bigint;
  amount0: bigint;
  amount1: bigint;
  inRange: boolean;
  percentThroughRange: number;
  pool: Address;
  createdAt?: number;
}

export interface PositionCard extends PositionSnapshot {
  amount0Usd: number;
  amount1Usd: number;
  feesUsd: number;
  positionUsd: number;
  feeApr: number;
  totalApr: number;
  holdUsd: number;
  divergence: number;
  ageDays: number;
  holdSource?: string;
  holdNote?: string;
}

export interface EconomicsInput {
  feesUsd: number;
  notionalUsd: number;
  gasUsd: number;
  minFeeUsd: number;
  minPositionUsd: number;
  takeBps: number;
  noFee: boolean;
  /** USD base the take is applied to. Defaults to feesUsd (compound / fee-source=fees). */
  takeBaseUsd?: number;
}

export interface EconomicsDecision {
  skip: boolean;
  reason?: string;
  takeUsd: number;
  netUsd: number;
}

export interface PolicyDefaults {
  minFeeUsd: number;
  minPositionUsd: number;
  maxPriceImpactBps: number;
  cooldownSec: number;
  spendCapUsd: number;
  oorPercent: number;
  compound: boolean;
  autoRange: boolean;
  autoExit: boolean;
  feeSource: FeeSource;
  noFee: boolean;
  exitPrice?: number;
  exitToken?: string;
}

export interface PositionPolicy extends Partial<PolicyDefaults> {
  tokenId: string;
  lastRunAt?: number;
}

export interface UnaBotConfig {
  defaults: PolicyDefaults;
  positions: Record<string, PositionPolicy>;
}

export interface AlertEvent {
  level: "info" | "warn" | "error";
  kind: string;
  message: string;
  tokenId?: string;
  at: string;
}

export interface AlertSink {
  emit(event: AlertEvent): void | Promise<void>;
}

export interface ProtocolAdapter {
  protocol: Protocol;
  listPositions(owner: Address): Promise<PositionRef[]>;
  readPosition(tokenId: bigint): Promise<PositionSnapshot>;
  importViaLogs?(owner: Address, fromBlock?: bigint): Promise<bigint[]>;
}
