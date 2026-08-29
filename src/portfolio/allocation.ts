import {
  getAddress,
  isAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { addressesFor, chainOf, type ChainSlug } from "../chains.js";
import { poolAbi, quoterV2Abi } from "../chain/abi.js";
import { loadEnv } from "../config/env.js";
import { TREASURY } from "../constants.js";
import { bpsOf } from "../core/fees.js";
import { quoteMintFromPool, snapshotFromQuote } from "../core/mint.js";
import { makePublicClient } from "../signer/broadcast.js";
import type { PlannedTx, TokenRef } from "../types.js";
import { erc20ApproveTx, mintCalldata, nativeTransferTx, wrapEthTx } from "../uniswap/calldata.js";
import { exactInV3Tx } from "../uniswap/router.js";
import { permit2ApproveTx } from "../uniswap/v4-calldata.js";
import { activeMarkets, chainCatalog, getMarketCatalog, type CuratedMarket } from "../markets/catalog.js";

const BPS = 10_000n;
const SWAP_SHARE_BPS = 5_000n;
const SWAP_SLIPPAGE_BPS = 150n;
const PLAN_TTL_MS = 8 * 60 * 1_000;

export type SerializableTx = {
  to: Address;
  data: Hex;
  value: string;
  description: string;
};

export type AllocationMarketPlan = {
  marketId: string;
  symbol: string;
  pool: Address;
  weightBps: number;
  budgetWei: string;
  swapInWei: string;
  quotedMemeOut: string;
  minimumMemeOut: string;
  mintWeth: string;
  mintMeme: string;
  tickLower: number;
  tickUpper: number;
  leftoverWeth: string;
  leftoverMeme: string;
};

export type AllocationPlan = {
  kind: "allocate";
  owner: Address;
  chain: ChainSlug;
  chainId: number;
  amountWei: string;
  serviceFeeBps: number;
  serviceFeeWei: string;
  netAllocationWei: string;
  expectedConfirmations: 1;
  execution: "wallet_sendCalls";
  atomic: true;
  createdAt: string;
  expiresAt: string;
  markets: AllocationMarketPlan[];
  transactions: SerializableTx[];
  allowedTargets: Address[];
  notices: string[];
};

type MarketQuote = {
  market: CuratedMarket;
  marketPlan: AllocationMarketPlan;
  swap: PlannedTx;
  mint: PlannedTx;
  mintWeth: bigint;
  mintMeme: bigint;
};

export async function planAllocation(input: {
  owner: string;
  chain: ChainSlug;
  amountWei: bigint;
  marketIds?: readonly string[];
}): Promise<AllocationPlan> {
  if (!isAddress(input.owner)) throw new Error("owner must be a valid EVM address");
  const owner = getAddress(input.owner);
  const chain = chainOf(input.chain);
  const configured = chainCatalog(input.chain);
  if (input.amountWei < BigInt(configured.minimumAllocationWei)) {
    throw new Error(`Minimum ${configured.label} allocation is ${configured.minimumAllocationWei} wei`);
  }
  const markets = activeMarkets(input.chain, input.marketIds);
  const activeWeight = markets.reduce((sum, market) => sum + market.weightBps, 0);
  if (activeWeight <= 0) throw new Error("selected market weights must be positive");

  const feeBps = getMarketCatalog().fees.allocateBps;
  const serviceFee = bpsOf(input.amountWei, feeBps);
  const net = input.amountWei - serviceFee;
  if (net <= 0n) throw new Error("allocation is too small after fees");

  const env = loadEnv();
  const client = makePublicClient(env.rpcByChain[input.chain], chain.viem);
  const budgets = weightedBudgets(net, markets.map((market) => market.weightBps));
  const quotes: MarketQuote[] = [];
  for (const [index, market] of markets.entries()) {
    const budget = budgets[index];
    if (budget === undefined) throw new Error(`missing allocation budget for ${market.id}`);
    quotes.push(await quoteMarket(client, owner, chain.id, market, budget));
  }

  const addresses = addressesFor(input.chain);
  const swapWeth = quotes.reduce((sum, quote) => sum + BigInt(quote.marketPlan.swapInWei), 0n);
  const mintWeth = quotes.reduce((sum, quote) => sum + quote.mintWeth, 0n);
  const transactions: PlannedTx[] = [wrapEthTx(net, chain.id)];
  if (swapWeth > 0n) {
    transactions.push(
      erc20ApproveTx(addresses.weth, addresses.permit2, swapWeth),
      permit2ApproveTx(addresses.weth, addresses.universalRouter, swapWeth, 20 * 60),
      ...quotes.map((quote) => quote.swap),
    );
  }
  if (mintWeth > 0n) transactions.push(erc20ApproveTx(addresses.weth, addresses.nfpm, mintWeth));
  for (const quote of quotes) {
    if (quote.mintMeme > 0n) transactions.push(erc20ApproveTx(quote.market.token, addresses.nfpm, quote.mintMeme));
  }
  transactions.push(...quotes.map((quote) => quote.mint));
  if (serviceFee > 0n) transactions.push(nativeTransferTx(env.treasury ?? TREASURY, serviceFee));

  const allowedTargets = uniqueAddresses([
    addresses.weth,
    addresses.permit2,
    addresses.universalRouter,
    addresses.nfpm,
    env.treasury ?? TREASURY,
    ...markets.map((market) => market.token),
  ]);
  assertAllowedTransactions(transactions, allowedTargets);

  const now = new Date();
  return {
    kind: "allocate",
    owner,
    chain: input.chain,
    chainId: chain.id,
    amountWei: input.amountWei.toString(),
    serviceFeeBps: feeBps,
    serviceFeeWei: serviceFee.toString(),
    netAllocationWei: net.toString(),
    expectedConfirmations: 1,
    execution: "wallet_sendCalls",
    atomic: true,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PLAN_TTL_MS).toISOString(),
    markets: quotes.map((quote) => quote.marketPlan),
    transactions: transactions.map(serializeTx),
    allowedTargets,
    notices: [
      "Every LP NFT is minted directly to your wallet.",
      "One atomic wallet batch is requested on this chain; if any call fails, the entire batch reverts.",
      "Quoted outputs and ranges expire. Re-plan instead of signing an expired batch.",
      "Any unused WETH or meme tokens remain in your wallet.",
    ],
  };
}

export function weightedBudgets(total: bigint, weights: readonly number[]): bigint[] {
  const sum = weights.reduce((acc, value) => acc + value, 0);
  if (!Number.isSafeInteger(sum) || sum <= 0) throw new Error("weights must sum to a positive safe integer");
  let allocated = 0n;
  return weights.map((weight, index) => {
    if (!Number.isSafeInteger(weight) || weight <= 0) throw new Error("weights must be positive safe integers");
    if (index === weights.length - 1) return total - allocated;
    const amount = (total * BigInt(weight)) / BigInt(sum);
    allocated += amount;
    return amount;
  });
}

async function quoteMarket(
  client: PublicClient,
  owner: Address,
  chainId: number,
  market: CuratedMarket,
  budget: bigint,
): Promise<MarketQuote> {
  const swapIn = (budget * SWAP_SHARE_BPS) / BPS;
  const wethForMint = budget - swapIn;
  if (swapIn <= 0n || wethForMint <= 0n) throw new Error(`${market.id} allocation is too small`);

  const [slot0, token0Address, token1Address, quoteResult] = await Promise.all([
    client.readContract({ address: market.pool, abi: poolAbi, functionName: "slot0" }),
    client.readContract({ address: market.pool, abi: poolAbi, functionName: "token0" }),
    client.readContract({ address: market.pool, abi: poolAbi, functionName: "token1" }),
    client.simulateContract({
      address: addressesFor(chainId === 4663 ? "robinhood" : "base").quoterV2,
      abi: quoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [{
        tokenIn: market.quoteToken,
        tokenOut: market.token,
        amountIn: swapIn,
        fee: market.fee,
        sqrtPriceLimitX96: 0n,
      }],
    }),
  ]);
  const pair = new Set([token0Address.toLowerCase(), token1Address.toLowerCase()]);
  if (!pair.has(market.token.toLowerCase()) || !pair.has(market.quoteToken.toLowerCase())) {
    throw new Error(`${market.id} pool tokens do not match the curated pair`);
  }
  const quotedMemeOut = quoteResult.result[0];
  if (quotedMemeOut <= 0n) throw new Error(`${market.id} returned no swap output`);
  const minimumMemeOut = (quotedMemeOut * (BPS - SWAP_SLIPPAGE_BPS)) / BPS;

  const quoteToken: TokenRef = { address: market.quoteToken, symbol: market.quoteSymbol, decimals: market.quoteDecimals };
  const memeToken: TokenRef = { address: market.token, symbol: market.symbol, decimals: market.tokenDecimals };
  const quoteIsToken0 = token0Address.toLowerCase() === market.quoteToken.toLowerCase();
  const token0 = quoteIsToken0 ? quoteToken : memeToken;
  const token1 = quoteIsToken0 ? memeToken : quoteToken;
  // The swap may settle anywhere between minimumMemeOut and quotedMemeOut.
  // Plan the mint against the guaranteed floor so the atomic batch does not
  // revert merely because the quote moved within the accepted slippage band.
  const amount0Desired = quoteIsToken0 ? wethForMint : minimumMemeOut;
  const amount1Desired = quoteIsToken0 ? minimumMemeOut : wethForMint;
  const mintQuote = quoteMintFromPool({
    chainId,
    protocol: "V3",
    token0,
    token1,
    fee: market.fee,
    sqrtPriceX96: slot0[0],
    tickCurrent: slot0[1],
    pool: market.pool,
    widthPct: market.rangeWidthPct,
    amount0Desired,
    amount1Desired,
  });
  const mintWeth = quoteIsToken0 ? mintQuote.amount0 : mintQuote.amount1;
  const mintMeme = quoteIsToken0 ? mintQuote.amount1 : mintQuote.amount0;
  const mint = mintCalldata({
    position: snapshotFromQuote(mintQuote, owner),
    tickLower: mintQuote.tickLower,
    tickUpper: mintQuote.tickUpper,
    amount0: mintQuote.amount0,
    amount1: mintQuote.amount1,
    recipient: owner,
    slippageBps: Number(SWAP_SLIPPAGE_BPS),
    deadlineSec: Math.floor(PLAN_TTL_MS / 1_000),
  });
  const swap = exactInV3Tx({
    tokenIn: market.quoteToken,
    tokenOut: market.token,
    fee: market.fee,
    amountIn: swapIn,
    amountOutMin: minimumMemeOut,
    recipient: owner,
    payerIsUser: true,
    deadlineSec: Math.floor(PLAN_TTL_MS / 1_000),
    chainId,
  });

  return {
    market,
    marketPlan: {
      marketId: market.id,
      symbol: market.symbol,
      pool: market.pool,
      weightBps: market.weightBps,
      budgetWei: budget.toString(),
      swapInWei: swapIn.toString(),
      quotedMemeOut: quotedMemeOut.toString(),
      minimumMemeOut: minimumMemeOut.toString(),
      mintWeth: mintWeth.toString(),
      mintMeme: mintMeme.toString(),
      tickLower: mintQuote.tickLower,
      tickUpper: mintQuote.tickUpper,
      leftoverWeth: (wethForMint - mintWeth).toString(),
      leftoverMeme: (minimumMemeOut - mintMeme).toString(),
    },
    swap,
    mint,
    mintWeth,
    mintMeme,
  };
}

function serializeTx(tx: PlannedTx): SerializableTx {
  return { ...tx, value: tx.value.toString() };
}

function uniqueAddresses(addresses: readonly Address[]): Address[] {
  const out = new Map<string, Address>();
  for (const address of addresses) out.set(address.toLowerCase(), getAddress(address));
  return [...out.values()];
}

function assertAllowedTransactions(transactions: readonly PlannedTx[], allowedTargets: readonly Address[]): void {
  const allowed = new Set(allowedTargets.map((address) => address.toLowerCase()));
  for (const tx of transactions) {
    if (!allowed.has(tx.to.toLowerCase())) throw new Error(`Refuse unapproved transaction target ${tx.to}`);
    if (tx.data === "0x" && tx.value === 0n) throw new Error(`Refuse empty zero-value transaction to ${tx.to}`);
  }
}
