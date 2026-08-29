import { getAddress, type Address, type PublicClient } from "viem";
import { ADDRESSES } from "../constants.js";
import { readTokenMeta } from "../chain/positions.js";
import { simulateTxs } from "../chain/mint-history.js";
import { createUniswapHttp } from "../uniswap/http.js";
import { LpApi, txFromApi } from "../uniswap/lp-api.js";
import { loadV4Pool } from "../chain/v4.js";
import type { PlannedTx, Protocol } from "../types.js";
import {
  formatMintQuote,
  loadPoolForMint,
  loadV2Pair,
  planMint,
  quoteMintFromPool,
  quoteMintV2,
  resolveMintToken,
  sortPoolPair,
  type MintQuote,
} from "./mint.js";
import { rememberHold } from "./hold.js";
import type { ActionReceipt } from "../types.js";

export interface MintFlowInput {
  client: PublicClient;
  owner: Address;
  token0: string;
  token1: string;
  fee: number;
  widthPct?: number;
  tickLower?: number;
  tickUpper?: number;
  amount0?: bigint;
  amount1?: bigint;
  dryRun: boolean;
  apiKey?: string;
  protocol?: Protocol;
}

export interface MintFlowResult {
  quote: MintQuote;
  receipt: ActionReceipt;
  simulation: { description: string; ok: boolean; error?: string }[];
  usedLpApi: boolean;
  card: string;
}

export async function runMintFlow(input: MintFlowInput): Promise<MintFlowResult> {
  const protocol = input.protocol ?? "V3";
  const a = resolveMintToken(input.token0);
  const b = resolveMintToken(input.token1);
  const amtA = input.amount0;
  const amtB = input.amount1;
  const rawA = { address: a.address, useNative: a.useNative, amount: amtA ?? 0n, key: "0" as const };
  const rawB = { address: b.address, useNative: b.useNative, amount: amtB ?? 0n, key: "1" as const };
  const [t0, t1] = sortPoolPair(rawA, rawB);

  const [meta0, meta1] = await Promise.all([
    readTokenMeta(input.client, t0.address),
    readTokenMeta(input.client, t1.address),
  ]);

  let quote: MintQuote;
  if (protocol === "V2") {
    const pair = await loadV2Pair(input.client, t0.address, t1.address);
    const amount0 = pair.token0.toLowerCase() === t0.address.toLowerCase() ? t0.amount : t1.amount;
    const amount1 = pair.token1.toLowerCase() === t1.address.toLowerCase() ? t1.amount : t0.amount;
    const token0 = pair.token0.toLowerCase() === meta0.address.toLowerCase() ? meta0 : meta1;
    const token1 = pair.token1.toLowerCase() === meta1.address.toLowerCase() ? meta1 : meta0;
    quote = quoteMintV2({
      token0,
      token1,
      reserve0: pair.reserve0,
      reserve1: pair.reserve1,
      pool: pair.pool,
      amount0Desired: amount0,
      amount1Desired: amount1,
      useNative: t0.useNative || t1.useNative,
      nativeIsToken0: pair.token0.toLowerCase() === t0.address.toLowerCase() ? t0.useNative : t1.useNative,
    });
  } else if (protocol === "V4") {
    const currency0 = t0.useNative ? ADDRESSES.nativeEth : t0.address;
    const currency1 = t1.useNative ? ADDRESSES.nativeEth : t1.address;
    const pool = await loadV4Pool(input.client, currency0, currency1, input.fee);
    quote = quoteMintFromPool({
      protocol: "V4",
      token0: t0.useNative ? { ...meta0, symbol: "ETH" } : meta0,
      token1: t1.useNative ? { ...meta1, symbol: "ETH" } : meta1,
      fee: input.fee,
      sqrtPriceX96: pool.sqrtPriceX96,
      tickCurrent: pool.tick,
      pool: ADDRESSES.v4PoolManager,
      widthPct: input.widthPct,
      tickLower: input.tickLower,
      tickUpper: input.tickUpper,
      amount0Desired: t0.amount,
      amount1Desired: t1.amount,
      useNative: t0.useNative || t1.useNative,
      nativeIsToken0: t0.useNative,
    });
    quote.poolId = pool.poolId;
    quote.hooks = pool.key.hooks;
  } else {
    const pool = await loadPoolForMint(input.client, t0.address, t1.address, input.fee);
    quote = quoteMintFromPool({
      protocol: "V3",
      token0: meta0,
      token1: meta1,
      fee: input.fee,
      sqrtPriceX96: pool.sqrtPriceX96,
      tickCurrent: pool.tick,
      pool: pool.pool,
      widthPct: input.widthPct,
      tickLower: input.tickLower,
      tickUpper: input.tickUpper,
      amount0Desired: t0.amount,
      amount1Desired: t1.amount,
      useNative: t0.useNative || t1.useNative,
      nativeIsToken0: t0.useNative,
    });
  }

  let receipt = planMint(quote, input.owner, input.dryRun);
  let usedLpApi = false;

  if (input.apiKey) {
    const apiTxs = await tryLpApi(input.apiKey, quote, input.owner);
    if (apiTxs && apiTxs.length > 0) {
      usedLpApi = true;
      receipt = {
        ...receipt,
        txs: [...receipt.txs.filter((t) => t.description.startsWith("approve") || t.description.startsWith("Permit2")), ...apiTxs],
        actions: receipt.actions.map((action) => {
          if (action.kind !== "mint") return action;
          return { ...action, tx: apiTxs[0] };
        }),
      };
    }
  }

  const simulation = await simulateTxs(input.client, input.owner, receipt.txs);
  return {
    quote,
    receipt,
    simulation,
    usedLpApi,
    card: formatMintQuote(quote),
  };
}

async function tryLpApi(apiKey: string, quote: MintQuote, owner: Address): Promise<PlannedTx[] | undefined> {
  try {
    const lp = new LpApi(createUniswapHttp(apiKey));
    const independent = quote.amount0 > 0n
      ? { tokenAddress: quote.token0, amount: quote.amount0.toString() }
      : { tokenAddress: quote.token1, amount: quote.amount1.toString() };

    if (quote.protocol === "V2") {
      const created = await lp.createClassic({
        walletAddress: owner,
        poolParameters: {
          token0Address: quote.token0,
          token1Address: quote.token1,
          chainId: 8453,
        },
        independentToken: independent,
        simulateTransaction: true,
      });
      const tx = txFromApi(created.create, "Uniswap LP API create_classic");
      return tx ? [tx] : undefined;
    }

    const created = await lp.create({
      walletAddress: owner,
      protocol: quote.protocol === "V4" ? "V4" : "V3",
      chainId: 8453,
      existingPool: {
        token0Address: quote.token0,
        token1Address: quote.token1,
        poolReference: quote.protocol === "V4" ? (quote.poolId ?? quote.pool) : quote.pool,
      },
      independentToken: independent,
      tickBounds: { tickLower: quote.tickLower, tickUpper: quote.tickUpper },
      simulateTransaction: true,
    });
    const tx = txFromApi(created.create, "Uniswap LP API create");
    return tx ? [tx] : undefined;
  } catch {
    return undefined;
  }
}

export function persistMintHold(quote: MintQuote, tokenId: bigint, path?: string): void {
  if (tokenId === 0n) return;
  rememberHold(tokenId, quote.amount0, quote.amount1, "live-mint", { path });
}

export function extraAllowForMint(quote: MintQuote): Address[] {
  return [quote.token0, quote.token1, ADDRESSES.weth, ADDRESSES.v2Router, ADDRESSES.v4PositionManager, ADDRESSES.permit2];
}

export async function tryLpWrite(args: {
  apiKey: string;
  protocol: Protocol;
  owner: Address;
  action: "increase" | "decrease" | "claim";
  token0: Address;
  token1: Address;
  tokenId: bigint;
  independent?: { tokenAddress: string; amount: string };
  pct?: number;
}): Promise<PlannedTx | undefined> {
  const lp = new LpApi(createUniswapHttp(args.apiKey));
  try {
    if (args.action === "claim") {
      if (args.protocol === "V2") return undefined;
      const res = await lp.claimFees({
        protocol: args.protocol,
        walletAddress: args.owner,
        chainId: 8453,
        tokenId: args.tokenId.toString(),
        simulateTransaction: true,
      });
      return txFromApi(res.claim, "Uniswap LP API claim_fees");
    }
    if (args.action === "increase") {
      const res = await lp.increase({
        walletAddress: args.owner,
        chainId: 8453,
        protocol: args.protocol,
        token0Address: args.token0,
        token1Address: args.token1,
        nftTokenId: args.protocol === "V2" ? undefined : args.tokenId.toString(),
        independentToken: args.independent ?? { tokenAddress: args.token0, amount: "0" },
        simulateTransaction: true,
      });
      return txFromApi(res.increase, "Uniswap LP API increase");
    }
    const res = await lp.decrease({
      walletAddress: args.owner,
      chainId: 8453,
      protocol: args.protocol,
      token0Address: args.token0,
      token1Address: args.token1,
      nftTokenId: args.protocol === "V2" ? undefined : args.tokenId.toString(),
      liquidityPercentageToDecrease: args.pct ?? 100,
      simulateTransaction: true,
    });
    return txFromApi(res.decrease, "Uniswap LP API decrease");
  } catch {
    return undefined;
  }
}
