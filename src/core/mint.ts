import { Ether, Token } from "@uniswap/sdk-core";
import { Pool, Position } from "@uniswap/v3-sdk";
import { getAddress, type Address, type PublicClient } from "viem";
import { ADDRESSES, CHAIN_ID } from "../constants.js";
import { factoryAbi, poolAbi } from "../chain/abi.js";
import { erc20ApproveTx, mintCalldata } from "../uniswap/calldata.js";
import { rangeFromWidthPct, snapRange, tickSpacingForFee } from "./ticks.js";
import type { ActionReceipt, PlannedAction, PlannedTx, PositionSnapshot, TokenRef } from "../types.js";

export interface MintQuote {
  token0: Address;
  token1: Address;
  symbol0: string;
  symbol1: string;
  decimals0: number;
  decimals1: number;
  fee: number;
  pool: Address;
  tickCurrent: number;
  tickLower: number;
  tickUpper: number;
  sqrtPriceX96: bigint;
  amount0: bigint;
  amount1: bigint;
  liquidity: string;
  singleSided: boolean;
  useNative: boolean;
  nativeIsToken0: boolean;
}

export function resolveMintToken(input: string): { address: Address; useNative: boolean } {
  const trimmed = input.trim();
  if (/^ETH$/i.test(trimmed) || trimmed.toLowerCase() === ADDRESSES.nativeEth.toLowerCase()) {
    return { address: ADDRESSES.weth, useNative: true };
  }
  if (/^WETH$/i.test(trimmed)) return { address: ADDRESSES.weth, useNative: false };
  if (/^USDC$/i.test(trimmed)) return { address: ADDRESSES.usdc, useNative: false };
  return { address: getAddress(trimmed), useNative: false };
}

export function sortPoolPair(
  a: { address: Address; useNative: boolean; amount?: bigint; meta?: TokenRef },
  b: { address: Address; useNative: boolean; amount?: bigint; meta?: TokenRef },
): [typeof a, typeof b] {
  return a.address.toLowerCase() < b.address.toLowerCase() ? [a, b] : [b, a];
}

export function quoteMintFromPool(args: {
  token0: TokenRef;
  token1: TokenRef;
  fee: number;
  sqrtPriceX96: bigint;
  tickCurrent: number;
  pool: Address;
  tickLower?: number;
  tickUpper?: number;
  widthPct?: number;
  amount0Desired?: bigint;
  amount1Desired?: bigint;
  useNative?: boolean;
  nativeIsToken0?: boolean;
}): MintQuote {
  const spacing = tickSpacingForFee(args.fee);
  let range: { tickLower: number; tickUpper: number };
  if (args.tickLower !== undefined && args.tickUpper !== undefined) {
    range = snapRange(args.tickLower, args.tickUpper, spacing);
  } else if (args.widthPct !== undefined) {
    range = rangeFromWidthPct(args.tickCurrent, args.widthPct, spacing);
  } else {
    throw new Error("mint requires --width <pct> or --tick-lower and --tick-upper");
  }

  const a0 = args.amount0Desired ?? 0n;
  const a1 = args.amount1Desired ?? 0n;
  if (a0 === 0n && a1 === 0n) {
    throw new Error("mint requires --amount0 and/or --amount1 in raw units");
  }

  const t0 = new Token(CHAIN_ID, args.token0.address, args.token0.decimals, args.token0.symbol);
  const t1 = new Token(CHAIN_ID, args.token1.address, args.token1.decimals, args.token1.symbol);
  const pool = new Pool(t0, t1, args.fee, args.sqrtPriceX96.toString(), "0", args.tickCurrent);

  let pos: Position;
  if (a0 > 0n && a1 === 0n) {
    pos = Position.fromAmount0({
      pool,
      tickLower: range.tickLower,
      tickUpper: range.tickUpper,
      amount0: a0.toString(),
      useFullPrecision: false,
    });
  } else if (a1 > 0n && a0 === 0n) {
    pos = Position.fromAmount1({
      pool,
      tickLower: range.tickLower,
      tickUpper: range.tickUpper,
      amount1: a1.toString(),
    });
  } else {
    pos = Position.fromAmounts({
      pool,
      tickLower: range.tickLower,
      tickUpper: range.tickUpper,
      amount0: a0.toString(),
      amount1: a1.toString(),
      useFullPrecision: false,
    });
  }

  return {
    token0: args.token0.address,
    token1: args.token1.address,
    symbol0: args.token0.symbol,
    symbol1: args.token1.symbol,
    decimals0: args.token0.decimals,
    decimals1: args.token1.decimals,
    fee: args.fee,
    pool: args.pool,
    tickCurrent: args.tickCurrent,
    tickLower: range.tickLower,
    tickUpper: range.tickUpper,
    sqrtPriceX96: args.sqrtPriceX96,
    amount0: BigInt(pos.amount0.quotient.toString()),
    amount1: BigInt(pos.amount1.quotient.toString()),
    liquidity: pos.liquidity.toString(),
    singleSided: a0 === 0n || a1 === 0n,
    useNative: Boolean(args.useNative),
    nativeIsToken0: Boolean(args.nativeIsToken0),
  };
}

export function snapshotFromQuote(quote: MintQuote, owner: Address): PositionSnapshot {
  return {
    ref: { protocol: "V3", chainId: CHAIN_ID, tokenId: 0n },
    owner,
    token0: { address: quote.token0, symbol: quote.symbol0, decimals: quote.decimals0 },
    token1: { address: quote.token1, symbol: quote.symbol1, decimals: quote.decimals1 },
    fee: quote.fee,
    tickSpacing: tickSpacingForFee(quote.fee),
    tickLower: quote.tickLower,
    tickUpper: quote.tickUpper,
    tickCurrent: quote.tickCurrent,
    sqrtPriceX96: quote.sqrtPriceX96,
    liquidity: BigInt(quote.liquidity),
    tokensOwed0: 0n,
    tokensOwed1: 0n,
    uncollected0: 0n,
    uncollected1: 0n,
    amount0: quote.amount0,
    amount1: quote.amount1,
    inRange: quote.tickCurrent >= quote.tickLower && quote.tickCurrent < quote.tickUpper,
    percentThroughRange: 0,
    pool: quote.pool,
  };
}

export function planMint(quote: MintQuote, owner: Address, dryRun: boolean): ActionReceipt {
  const actions: PlannedAction[] = [];
  const nativeAmount = quote.useNative
    ? quote.nativeIsToken0
      ? quote.amount0
      : quote.amount1
    : 0n;

  if (quote.useNative && nativeAmount > 0n) {
    actions.push({
      kind: "wrap",
      description: `ETH value ${nativeAmount} wraps inside NFPM.mint (useNative). NFT stays with ${owner}.`,
      tokenOut: ADDRESSES.weth,
      amountOut: nativeAmount,
    });
  }

  const needApprove0 = quote.amount0 > 0n && !(quote.useNative && quote.nativeIsToken0);
  const needApprove1 = quote.amount1 > 0n && !(quote.useNative && !quote.nativeIsToken0);

  if (needApprove0) {
    actions.push({
      kind: "approve",
      description: `approve NFPM for ${quote.symbol0}`,
      tokenIn: quote.token0,
      amountIn: quote.amount0,
      tx: erc20ApproveTx(quote.token0, ADDRESSES.nfpm, quote.amount0),
    });
  }
  if (needApprove1) {
    actions.push({
      kind: "approve",
      description: `approve NFPM for ${quote.symbol1}`,
      tokenIn: quote.token1,
      amountIn: quote.amount1,
      tx: erc20ApproveTx(quote.token1, ADDRESSES.nfpm, quote.amount1),
    });
  }

  const snap = snapshotFromQuote(quote, owner);
  actions.push({
    kind: "mint",
    description: `mint ${quote.symbol0}/${quote.symbol1} fee=${quote.fee} ticks [${quote.tickLower}, ${quote.tickUpper}] ${quote.singleSided ? "single-sided" : "two-sided"}`,
    amountIn: quote.amount0,
    amountOut: quote.amount1,
    recipient: owner,
    tx: mintCalldata({
      position: snap,
      tickLower: quote.tickLower,
      tickUpper: quote.tickUpper,
      amount0: quote.amount0,
      amount1: quote.amount1,
      recipient: owner,
      useNative: quote.useNative,
    }),
  });

  const txs: PlannedTx[] = actions.map((a) => a.tx).filter((tx): tx is PlannedTx => Boolean(tx));
  return {
    action: "mint",
    dryRun,
    skipped: false,
    from: owner,
    to: [ADDRESSES.nfpm, owner],
    actions,
    treasuryFee: null,
    txs,
  };
}

export function formatMintQuote(quote: MintQuote): string {
  return [
    `pool=${quote.pool} fee=${quote.fee} tick=${quote.tickCurrent}`,
    `ticks [${quote.tickLower}, ${quote.tickUpper}] snapped spacing=${tickSpacingForFee(quote.fee)}`,
    `amounts ${quote.amount0} ${quote.symbol0} + ${quote.amount1} ${quote.symbol1}  liquidity=${quote.liquidity}`,
    `singleSided=${quote.singleSided} useNative=${quote.useNative}`,
    "NFT mints to your wallet. No vault custody. Dry-run default.",
  ].join("\n");
}

export async function loadPoolForMint(
  client: PublicClient,
  tokenA: Address,
  tokenB: Address,
  fee: number,
): Promise<{ pool: Address; sqrtPriceX96: bigint; tick: number }> {
  const pool = await client.readContract({
    address: ADDRESSES.factory,
    abi: factoryAbi,
    functionName: "getPool",
    args: [tokenA, tokenB, fee],
  });
  if (pool === ADDRESSES.nativeEth) {
    throw new Error(`no v3 pool for ${tokenA}/${tokenB} fee=${fee} on Base`);
  }
  const slot0 = await client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" });
  return { pool, sqrtPriceX96: slot0[0], tick: slot0[1] };
}

export { Ether };
