import { Token } from "@uniswap/sdk-core";
import { Pool, Position } from "@uniswap/v3-sdk";
import { getAddress, type Address, type PublicClient } from "viem";
import { CHAIN_ID } from "../constants.js";
import type { ChainSlug } from "../chains.js";
import { addressesFor, slugForChainId, slugOfClient } from "../chains.js";
import { factoryAbi, poolAbi, v2FactoryAbi, v2PairAbi } from "../chain/abi.js";
import { erc20ApproveTx, mintCalldata } from "../uniswap/calldata.js";
import { addLiquidityTx } from "../uniswap/v2-calldata.js";
import { permit2ApproveTx, v4MintTx } from "../uniswap/v4-calldata.js";
import { rangeFromWidthPct, sdkFeeForTickSpacing, snapRange, tickSpacingForFee } from "./ticks.js";
import { isInRange, percentThroughRange } from "./range.js";
import type { ActionReceipt, PlannedAction, PlannedTx, PositionSnapshot, Protocol, TokenRef } from "../types.js";

export interface MintQuote {
  protocol: Protocol;
  chainId: number;
  token0: Address;
  token1: Address;
  symbol0: string;
  symbol1: string;
  decimals0: number;
  decimals1: number;
  fee: number;
  tickSpacing?: number;
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
  poolId?: `0x${string}`;
  hooks?: Address;
}

export function resolveMintToken(input: string, chain: ChainSlug = "base"): { address: Address; useNative: boolean } {
  const addrs = addressesFor(chain);
  const trimmed = input.trim();
  if (/^ETH$/i.test(trimmed) || trimmed.toLowerCase() === addrs.nativeEth.toLowerCase()) {
    return { address: addrs.weth, useNative: true };
  }
  if (/^WETH$/i.test(trimmed)) return { address: addrs.weth, useNative: false };
  if (/^USDG$/i.test(trimmed)) {
    if (!addrs.usdg) throw new Error("USDG is not listed on this chain.");
    return { address: addrs.usdg, useNative: false };
  }
  if (/^USDC$/i.test(trimmed)) {
    if (!addrs.usdc) throw new Error("No USDC on Robinhood. Use USDG.");
    return { address: addrs.usdc, useNative: false };
  }
  return { address: getAddress(trimmed), useNative: false };
}

export function sortPoolPair(
  a: { address: Address; useNative: boolean; amount?: bigint; meta?: TokenRef },
  b: { address: Address; useNative: boolean; amount?: bigint; meta?: TokenRef },
): [typeof a, typeof b] {
  return a.address.toLowerCase() < b.address.toLowerCase() ? [a, b] : [b, a];
}

export function quoteMintFromPool(args: {
  chainId?: number;
  protocol?: Protocol;
  token0: TokenRef;
  token1: TokenRef;
  fee: number;
  tickSpacing?: number;
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
  const spacing = args.tickSpacing ?? tickSpacingForFee(args.fee);
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

  const t0 = new Token(args.chainId ?? CHAIN_ID, args.token0.address, args.token0.decimals, args.token0.symbol);
  const t1 = new Token(args.chainId ?? CHAIN_ID, args.token1.address, args.token1.decimals, args.token1.symbol);
  const pool = new Pool(t0, t1, sdkFeeForTickSpacing(spacing), args.sqrtPriceX96.toString(), "0", args.tickCurrent);

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
    protocol: args.protocol ?? "V3",
    chainId: args.chainId ?? CHAIN_ID,
    token0: args.token0.address,
    token1: args.token1.address,
    symbol0: args.token0.symbol,
    symbol1: args.token1.symbol,
    decimals0: args.token0.decimals,
    decimals1: args.token1.decimals,
    fee: args.fee,
    tickSpacing: spacing,
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
    ref: { protocol: quote.protocol, chainId: quote.chainId ?? CHAIN_ID, tokenId: 0n },
    owner,
    token0: { address: quote.token0, symbol: quote.symbol0, decimals: quote.decimals0 },
    token1: { address: quote.token1, symbol: quote.symbol1, decimals: quote.decimals1 },
    fee: quote.fee,
    tickSpacing: quote.tickSpacing ?? tickSpacingForFee(quote.fee),
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
    inRange: isInRange(quote.tickCurrent, quote.tickLower, quote.tickUpper),
    percentThroughRange: percentThroughRange(quote.tickCurrent, quote.tickLower, quote.tickUpper),
    pool: quote.pool,
  };
}

export function planMint(quote: MintQuote, owner: Address, dryRun: boolean): ActionReceipt {
  if (quote.protocol === "V2") return planMintV2(quote, owner, dryRun);
  if (quote.protocol === "V4") return planMintV4(quote, owner, dryRun);
  return planMintV3(quote, owner, dryRun);
}

function planMintV3(quote: MintQuote, owner: Address, dryRun: boolean): ActionReceipt {
  const actions: PlannedAction[] = [];
  const addresses = addressesFor(slugForChainId(quote.chainId));
  const nativeAmount = quote.useNative
    ? quote.nativeIsToken0
      ? quote.amount0
      : quote.amount1
    : 0n;

  if (quote.useNative && nativeAmount > 0n) {
    actions.push({
      kind: "wrap",
      description: `ETH value ${nativeAmount} wraps inside NFPM.mint (useNative). You keep the NFT.`,
      tokenOut: addresses.weth,
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
      tx: erc20ApproveTx(quote.token0, addresses.nfpm, quote.amount0),
    });
  }
  if (needApprove1) {
    actions.push({
      kind: "approve",
      description: `approve NFPM for ${quote.symbol1}`,
      tokenIn: quote.token1,
      amountIn: quote.amount1,
      tx: erc20ApproveTx(quote.token1, addresses.nfpm, quote.amount1),
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

  return mintReceipt(quote, owner, dryRun, actions, addresses.nfpm);
}

function planMintV2(quote: MintQuote, owner: Address, dryRun: boolean): ActionReceipt {
  const actions: PlannedAction[] = [];
  const needApprove0 = quote.amount0 > 0n && !(quote.useNative && quote.nativeIsToken0);
  const needApprove1 = quote.amount1 > 0n && !(quote.useNative && !quote.nativeIsToken0);
  if (needApprove0) {
    actions.push({
      kind: "approve",
      description: `approve Router02 for ${quote.symbol0}`,
      tokenIn: quote.token0,
      amountIn: quote.amount0,
      tx: erc20ApproveTx(quote.token0, addressesFor(slugForChainId(quote.chainId)).v2Router, quote.amount0),
    });
  }
  if (needApprove1) {
    actions.push({
      kind: "approve",
      description: `approve Router02 for ${quote.symbol1}`,
      tokenIn: quote.token1,
      amountIn: quote.amount1,
      tx: erc20ApproveTx(quote.token1, addressesFor(slugForChainId(quote.chainId)).v2Router, quote.amount1),
    });
  }
  actions.push({
    kind: "mint",
    description: `add v2 liquidity ${quote.symbol0}/${quote.symbol1}. LP token stays with ${owner}.`,
    amountIn: quote.amount0,
    amountOut: quote.amount1,
    recipient: owner,
    tx: addLiquidityTx({
      tokenA: quote.token0,
      tokenB: quote.token1,
      amountADesired: quote.amount0,
      amountBDesired: quote.amount1,
      recipient: owner,
      useNative: quote.useNative,
      nativeIsTokenA: quote.nativeIsToken0,
      chainId: quote.chainId,
    }),
  });
  return mintReceipt(quote, owner, dryRun, actions, addressesFor(slugForChainId(quote.chainId)).v2Router);
}

function planMintV4(quote: MintQuote, owner: Address, dryRun: boolean): ActionReceipt {
  const actions: PlannedAction[] = [];
  const addresses = addressesFor(slugForChainId(quote.chainId));
  const hooks = quote.hooks ?? addresses.nativeEth;
  if (hooks.toLowerCase() !== addresses.nativeEth.toLowerCase()) {
    throw new Error(`Refuse unknown v4 hooks ${hooks}`);
  }
  const needApprove0 = quote.amount0 > 0n && !(quote.useNative && quote.nativeIsToken0);
  const needApprove1 = quote.amount1 > 0n && !(quote.useNative && !quote.nativeIsToken0);
  if (needApprove0) {
    actions.push({
      kind: "approve",
      description: `approve Permit2 for ${quote.symbol0}`,
      tokenIn: quote.token0,
      amountIn: quote.amount0,
      tx: erc20ApproveTx(quote.token0, addresses.permit2, quote.amount0),
    });
    actions.push({
      kind: "approve",
      description: `Permit2.approve PositionManager for ${quote.symbol0}`,
      tokenIn: quote.token0,
      amountIn: quote.amount0,
      tx: permit2ApproveTx(quote.token0, addresses.v4PositionManager, quote.amount0),
    });
  }
  if (needApprove1) {
    actions.push({
      kind: "approve",
      description: `approve Permit2 for ${quote.symbol1}`,
      tokenIn: quote.token1,
      amountIn: quote.amount1,
      tx: erc20ApproveTx(quote.token1, addresses.permit2, quote.amount1),
    });
    actions.push({
      kind: "approve",
      description: `Permit2.approve PositionManager for ${quote.symbol1}`,
      tokenIn: quote.token1,
      amountIn: quote.amount1,
      tx: permit2ApproveTx(quote.token1, addresses.v4PositionManager, quote.amount1),
    });
  }
  const currency0 = quote.useNative && quote.nativeIsToken0 ? addresses.nativeEth : quote.token0;
  const currency1 = quote.useNative && !quote.nativeIsToken0 ? addresses.nativeEth : quote.token1;
  const [c0, c1] = currency0.toLowerCase() < currency1.toLowerCase() ? [currency0, currency1] : [currency1, currency0];
  actions.push({
    kind: "mint",
    description: `mint v4 ${quote.symbol0}/${quote.symbol1} fee=${quote.fee} ticks [${quote.tickLower}, ${quote.tickUpper}]. You keep the NFT.`,
    amountIn: quote.amount0,
    amountOut: quote.amount1,
    recipient: owner,
    tx: v4MintTx({
      poolKey: {
        currency0: c0,
        currency1: c1,
        fee: quote.fee,
        tickSpacing: tickSpacingForFee(quote.fee),
        hooks,
      },
      tickLower: quote.tickLower,
      tickUpper: quote.tickUpper,
      liquidity: BigInt(quote.liquidity),
      amount0: quote.amount0,
      amount1: quote.amount1,
      recipient: owner,
      chainId: quote.chainId,
    }),
  });
  return mintReceipt(quote, owner, dryRun, actions, addresses.v4PositionManager);
}

function mintReceipt(
  quote: MintQuote,
  owner: Address,
  dryRun: boolean,
  actions: PlannedAction[],
  target: Address,
): ActionReceipt {
  const txs: PlannedTx[] = actions.map((a) => a.tx).filter((tx): tx is PlannedTx => Boolean(tx));
  return {
    action: "mint",
    dryRun,
    skipped: false,
    from: owner,
    to: [target, owner],
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
    quote.protocol === "V2"
      ? "v2 LP token stays in your wallet. No NFT. Dry-run default."
      : "NFT mints to your wallet. No vault custody. Dry-run default.",
  ].join("\n");
}

export async function loadPoolForMint(
  client: PublicClient,
  tokenA: Address,
  tokenB: Address,
  fee: number,
): Promise<{ pool: Address; sqrtPriceX96: bigint; tick: number }> {
  const a = addressesFor(slugOfClient(client));
  const pool = await client.readContract({
    address: a.factory,
    abi: factoryAbi,
    functionName: "getPool",
    args: [tokenA, tokenB, fee],
  });
  if (pool === a.nativeEth) {
    throw new Error(`no v3 pool for ${tokenA}/${tokenB} fee=${fee}`);
  }
  const slot0 = await client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" });
  return { pool, sqrtPriceX96: slot0[0], tick: slot0[1] };
}

export async function loadV2Pair(
  client: PublicClient,
  tokenA: Address,
  tokenB: Address,
): Promise<{ pool: Address; reserve0: bigint; reserve1: bigint; token0: Address; token1: Address }> {
  const a = addressesFor(slugOfClient(client));
  const pair = await client.readContract({
    address: a.v2Factory,
    abi: v2FactoryAbi,
    functionName: "getPair",
    args: [tokenA, tokenB],
  });
  if (pair === a.nativeEth) {
    throw new Error(`no v2 pair for ${tokenA}/${tokenB}`);
  }
  const [token0, token1, reserves] = await Promise.all([
    client.readContract({ address: pair, abi: v2PairAbi, functionName: "token0" }),
    client.readContract({ address: pair, abi: v2PairAbi, functionName: "token1" }),
    client.readContract({ address: pair, abi: v2PairAbi, functionName: "getReserves" }),
  ]);
  return { pool: pair, reserve0: reserves[0], reserve1: reserves[1], token0, token1 };
}

export function quoteMintV2(args: {
  chainId?: number;
  token0: TokenRef;
  token1: TokenRef;
  reserve0: bigint;
  reserve1: bigint;
  pool: Address;
  amount0Desired?: bigint;
  amount1Desired?: bigint;
  useNative?: boolean;
  nativeIsToken0?: boolean;
}): MintQuote {
  let a0 = args.amount0Desired ?? 0n;
  let a1 = args.amount1Desired ?? 0n;
  if (a0 === 0n && a1 === 0n) throw new Error("mint requires --amount0 and/or --amount1 in raw units");
  if (args.reserve0 === 0n || args.reserve1 === 0n) {
    if (a0 === 0n || a1 === 0n) throw new Error("new v2 pair requires both --amount0 and --amount1");
  } else if (a0 > 0n && a1 === 0n) {
    a1 = (a0 * args.reserve1) / args.reserve0;
  } else if (a1 > 0n && a0 === 0n) {
    a0 = (a1 * args.reserve0) / args.reserve1;
  } else {
    const bOpt = (a0 * args.reserve1) / args.reserve0;
    if (bOpt <= a1) a1 = bOpt;
    else a0 = (a1 * args.reserve0) / args.reserve1;
  }
  return {
    protocol: "V2",
    chainId: args.chainId ?? CHAIN_ID,
    token0: args.token0.address,
    token1: args.token1.address,
    symbol0: args.token0.symbol,
    symbol1: args.token1.symbol,
    decimals0: args.token0.decimals,
    decimals1: args.token1.decimals,
    fee: 3000,
    pool: args.pool,
    tickCurrent: 0,
    tickLower: 0,
    tickUpper: 0,
    sqrtPriceX96: 0n,
    amount0: a0,
    amount1: a1,
    liquidity: "0",
    singleSided: false,
    useNative: Boolean(args.useNative),
    nativeIsToken0: Boolean(args.nativeIsToken0),
  };
}
