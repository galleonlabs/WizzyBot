import { getAddress, type Address, type PublicClient } from "viem";
import { ADDRESSES } from "../constants.js";
import { readTokenMeta } from "../chain/positions.js";
import { simulateTxs } from "../chain/mint-history.js";
import { createUniswapHttp } from "../uniswap/http.js";
import { LpApi } from "../uniswap/lp-api.js";
import type { PlannedTx } from "../types.js";
import {
  formatMintQuote,
  loadPoolForMint,
  planMint,
  quoteMintFromPool,
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
}

export interface MintFlowResult {
  quote: MintQuote;
  receipt: ActionReceipt;
  simulation: { description: string; ok: boolean; error?: string }[];
  usedLpApi: boolean;
  card: string;
}

export async function runMintFlow(input: MintFlowInput): Promise<MintFlowResult> {
  const a = resolveMintToken(input.token0);
  const b = resolveMintToken(input.token1);
  const amtA = input.amount0;
  const amtB = input.amount1;
  // User-specified token0/token1 amounts follow the CLI flags, not sort order.
  // After sort we map amounts onto the sorted pair by address.
  const rawA = { address: a.address, useNative: a.useNative, amount: amtA ?? 0n, key: "0" as const };
  const rawB = { address: b.address, useNative: b.useNative, amount: amtB ?? 0n, key: "1" as const };
  const [t0, t1] = sortPoolPair(rawA, rawB);

  const pool = await loadPoolForMint(input.client, t0.address, t1.address, input.fee);
  const [meta0, meta1] = await Promise.all([
    readTokenMeta(input.client, t0.address),
    readTokenMeta(input.client, t1.address),
  ]);

  const quote = quoteMintFromPool({
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

  let receipt = planMint(quote, input.owner, input.dryRun);
  let usedLpApi = false;

  if (input.apiKey) {
    const apiTxs = await tryLpApi(input.apiKey, quote, input.owner);
    if (apiTxs && apiTxs.length > 0) {
      usedLpApi = true;
      receipt = {
        ...receipt,
        txs: apiTxs,
        actions: receipt.actions.map((action, i) =>
          apiTxs[i] ? { ...action, tx: apiTxs[i] } : action,
        ),
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
    const created = await lp.create({
      walletAddress: owner,
      protocol: "V3",
      chainId: 8453,
      existingPool: {
        token0Address: quote.token0,
        token1Address: quote.token1,
        poolReference: quote.pool,
      },
      independentToken: independent,
      tickBounds: { tickLower: quote.tickLower, tickUpper: quote.tickUpper },
      simulateTransaction: true,
    });
    const tx = created.create;
    if (!tx?.to || !tx.data) return undefined;
    return [
      {
        to: getAddress(tx.to),
        data: tx.data as `0x${string}`,
        value: BigInt(tx.value ?? "0"),
        description: "Uniswap LP API create",
      },
    ];
  } catch {
    return undefined;
  }
}

export function persistMintHold(quote: MintQuote, tokenId: bigint, path?: string): void {
  rememberHold(tokenId, quote.amount0, quote.amount1, "live-mint", { path });
}

export function extraAllowForMint(quote: MintQuote): Address[] {
  const extra: Address[] = [quote.token0, quote.token1, ADDRESSES.weth];
  return extra;
}
