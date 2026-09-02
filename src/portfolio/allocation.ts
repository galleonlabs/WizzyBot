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
import { loadV2Pair, planMint, quoteMintFromPool, quoteMintV2, snapshotFromQuote } from "../core/mint.js";
import { loadV4Pool } from "../chain/v4.js";
import { makePublicClient } from "../signer/broadcast.js";
import type { PlannedTx, TokenRef } from "../types.js";
import { erc20ApproveTx, mintCalldata, wrapEthTx } from "../uniswap/calldata.js";
import { exactInV3Tx } from "../uniswap/router.js";
import { activeMarkets, chainCatalog, type CuratedMarket } from "../markets/catalog.js";
import { slipstreamPoolAbi, slipstreamQuoterV2Abi } from "../aerodrome/abi.js";
import { exactInSlipstreamTx, mintSlipstreamTx } from "../aerodrome/calldata.js";
import { aerodromeDeployment } from "../aerodrome/deployments.js";
import { WALLET_PLAN_DEADLINE_SEC } from "../constants.js";
import { tickAtSqrtPriceX96 } from "../core/ticks.js";

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
  protocol: "V2" | "V3" | "V4";
  pool: Hex;
  venue: "uniswap-v2" | "uniswap-v3" | "uniswap-v4" | "aerodrome-slipstream";
  liquidityTarget: Address;
  quoteSymbol: "ETH" | "WETH";
  budgetWei: string;
  swapInWei: string;
  quotedMemeOut: string;
  minimumMemeOut: string;
  mintQuote: string;
  mintMeme: string;
  tickLower: number;
  tickUpper: number;
  leftoverQuote: string;
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
  execution: "wallet_transactions";
  atomic: false;
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
  swapSpender: Address;
  positionManager: Address;
  mintWeth: bigint;
  mintMeme: bigint;
};

export async function planAllocation(input: {
  owner: string;
  chain: ChainSlug;
  amountWei: bigint;
  marketId: string;
  protocol?: "V2" | "V3" | "V4";
  client?: PublicClient;
}): Promise<AllocationPlan> {
  if (!isAddress(input.owner)) throw new Error("owner must be a valid EVM address");
  const owner = getAddress(input.owner);
  const chain = chainOf(input.chain);
  const configured = chainCatalog(input.chain);
  if (input.amountWei < BigInt(configured.minimumAllocationWei)) {
    throw new Error(`Minimum ${configured.label} allocation is ${configured.minimumAllocationWei} wei`);
  }
  const markets = activeMarkets(input.chain, [input.marketId]);
  const market = markets[0];
  if (!market) throw new Error("Choose an active reviewed market");

  const net = input.amountWei;

  const env = loadEnv();
  const client = input.client ?? makePublicClient(env.rpcByChain[input.chain], chain.viem);
  if (input.protocol === "V2" || input.protocol === "V4") {
    return planAlternativeAllocation({
      owner,
      chain: input.chain,
      chainId: chain.id,
      market,
      amountWei: input.amountWei,
      net,
      protocol: input.protocol,
      client,
    });
  }
  const quotes: MarketQuote[] = [await quoteMarket(client, owner, chain.id, market, net, true)];

  const addresses = addressesFor(input.chain);
  const transactions: PlannedTx[] = [];
  const uniswapQuotes = quotes.filter((quote) => quote.marketPlan.venue === "uniswap-v3");
  transactions.push(...uniswapQuotes.map((quote) => quote.swap));
  const aerodromeQuotes = quotes.filter((quote) => quote.marketPlan.venue === "aerodrome-slipstream");
  const aerodromeBudget = aerodromeQuotes.reduce((sum, quote) => sum + BigInt(quote.marketPlan.budgetWei), 0n);
  if (aerodromeBudget > 0n) transactions.push(wrapEthTx(aerodromeBudget, chain.id));
  for (const [router, routerQuotes] of groupedByAddress(
    aerodromeQuotes,
    (quote) => quote.swapSpender,
  )) {
    const amount = routerQuotes.reduce((sum, quote) => sum + BigInt(quote.marketPlan.swapInWei), 0n);
    if (amount > 0n) transactions.push(erc20ApproveTx(addresses.weth, router, amount), ...routerQuotes.map((quote) => quote.swap));
  }
  for (const [manager, managerQuotes] of groupedByAddress(aerodromeQuotes, (quote) => quote.positionManager)) {
    const amount = managerQuotes.reduce((sum, quote) => sum + quote.mintWeth, 0n);
    const aerodrome = managerQuotes.some((quote) => quote.marketPlan.venue === "aerodrome-slipstream");
    if (amount > 0n) transactions.push(erc20ApproveTx(addresses.weth, manager, aerodrome ? amount + 1n : amount));
  }
  for (const quote of quotes) {
    if (quote.mintMeme > 0n) {
      const amount = quote.marketPlan.venue === "aerodrome-slipstream" ? quote.mintMeme + 1n : quote.mintMeme;
      transactions.push(erc20ApproveTx(quote.market.token, quote.positionManager, amount));
    }
  }
  transactions.push(...quotes.map((quote) => quote.mint));

  const allowedTargets = uniqueAddresses([
    addresses.weth,
    ...markets.map((market) => market.token),
    ...quotes.flatMap((quote) => [quote.swapSpender, quote.positionManager]),
    ...(uniswapQuotes.length ? [addresses.swapRouter02] : []),
  ]);
  assertAllowedTransactions(transactions, allowedTargets);

  const now = new Date();
  return {
    kind: "allocate",
    owner,
    chain: input.chain,
    chainId: chain.id,
    amountWei: input.amountWei.toString(),
    serviceFeeBps: 0,
    serviceFeeWei: "0",
    netAllocationWei: net.toString(),
    expectedConfirmations: 1,
    execution: "wallet_transactions",
    atomic: false,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PLAN_TTL_MS).toISOString(),
    markets: quotes.map((quote) => quote.marketPlan),
    transactions: transactions.map(serializeTx),
    allowedTargets,
    notices: [
      "The selected LP position is minted directly to your wallet.",
      "Your wallet confirms each step. Every completed step settles to your wallet, and Wizzy never takes custody.",
      "Quoted outputs and ranges expire. Re-plan instead of signing an expired plan.",
      "Wizzy uses the reviewed Uniswap or Aerodrome pool selected on the market row; there is no basket allocation.",
      "Any unused ETH, WETH, or meme tokens remain in your wallet.",
    ],
  };
}

type AlternativeProtocol = "V2" | "V4";

export function liquidityVenueFor(market: CuratedMarket, protocol: AlternativeProtocol) {
  const venue = market.liquidityVenues.find((candidate) => candidate.protocol === protocol);
  if (!venue) throw new Error(`${market.symbol} has no reviewed Uniswap ${protocol} pool`);
  return venue;
}

async function planAlternativeAllocation(input: {
  owner: Address;
  chain: ChainSlug;
  chainId: number;
  market: CuratedMarket;
  amountWei: bigint;
  net: bigint;
  protocol: AlternativeProtocol;
  client: PublicClient;
}): Promise<AllocationPlan> {
  const venue = liquidityVenueFor(input.market, input.protocol);
  const addresses = addressesFor(input.chain);
  const acquisition = await quoteMarket(input.client, input.owner, input.chainId, input.market, input.net);
  const swapIn = BigInt(acquisition.marketPlan.swapInWei);
  const memeFloor = BigInt(acquisition.marketPlan.minimumMemeOut);
  const quoteForMint = input.net - swapIn;
  const quoteToken: TokenRef = { address: input.market.quoteToken, symbol: "WETH", decimals: input.market.quoteDecimals };
  const memeToken: TokenRef = { address: input.market.token, symbol: input.market.symbol, decimals: input.market.tokenDecimals };

  let marketPlan: AllocationMarketPlan;
  let mintTransactions: PlannedTx[];
  let wrapAmount: bigint;
  let liquidityTargets: Address[];
  let custodyNotice: string;

  if (venue.protocol === "V2") {
    const pair = await loadV2Pair(input.client, input.market.quoteToken, input.market.token);
    if (pair.pool.toLowerCase() !== venue.pool.toLowerCase()) throw new Error(`${input.market.symbol} V2 pool no longer matches the reviewed pair`);
    const pairTokens = new Set([pair.token0.toLowerCase(), pair.token1.toLowerCase()]);
    if (!pairTokens.has(input.market.quoteToken.toLowerCase()) || !pairTokens.has(input.market.token.toLowerCase())) {
      throw new Error(`${input.market.symbol} V2 pool tokens do not match the reviewed pair`);
    }
    const quoteIsToken0 = pair.token0.toLowerCase() === input.market.quoteToken.toLowerCase();
    const mintQuote = quoteMintV2({
      chainId: input.chainId,
      token0: quoteIsToken0 ? quoteToken : memeToken,
      token1: quoteIsToken0 ? memeToken : quoteToken,
      reserve0: pair.reserve0,
      reserve1: pair.reserve1,
      pool: pair.pool,
      amount0Desired: quoteIsToken0 ? quoteForMint : memeFloor,
      amount1Desired: quoteIsToken0 ? memeFloor : quoteForMint,
    });
    const mintQuoteAmount = quoteIsToken0 ? mintQuote.amount0 : mintQuote.amount1;
    const mintMeme = quoteIsToken0 ? mintQuote.amount1 : mintQuote.amount0;
    mintTransactions = planMint(mintQuote, input.owner, false).txs;
    wrapAmount = input.net;
    liquidityTargets = [addresses.v2Router];
    custodyNotice = "The Uniswap V2 LP token is sent directly to your wallet.";
    marketPlan = {
      marketId: input.market.id,
      symbol: input.market.symbol,
      protocol: "V2",
      pool: pair.pool,
      venue: "uniswap-v2",
      liquidityTarget: addresses.v2Router,
      quoteSymbol: "WETH",
      budgetWei: input.net.toString(),
      swapInWei: swapIn.toString(),
      quotedMemeOut: acquisition.marketPlan.quotedMemeOut,
      minimumMemeOut: acquisition.marketPlan.minimumMemeOut,
      mintQuote: mintQuoteAmount.toString(),
      mintMeme: mintMeme.toString(),
      tickLower: 0,
      tickUpper: 0,
      leftoverQuote: (quoteForMint - mintQuoteAmount).toString(),
      leftoverMeme: (memeFloor - mintMeme).toString(),
    };
  } else {
    const live = await loadV4Pool(input.client, addresses.nativeEth, input.market.token, venue.fee, venue.hooks);
    if (live.poolId.toLowerCase() !== venue.poolId.toLowerCase()) throw new Error(`${input.market.symbol} V4 pool no longer matches the reviewed pool`);
    if (live.key.tickSpacing !== venue.tickSpacing || live.liquidity <= 0n) throw new Error(`${input.market.symbol} V4 pool is not currently usable`);
    // v4 mints encode a small maximum around each quoted token amount. Leave
    // that headroom inside the user's stated budget instead of asking the
    // wallet for more ETH than the plan declares.
    const maxSafe = (amount: bigint) => (amount * 10_000n) / 10_050n;
    const nativeDesired = maxSafe(quoteForMint);
    const memeDesired = maxSafe(memeFloor);
    const nativeToken: TokenRef = { address: addresses.nativeEth, symbol: "ETH", decimals: 18 };
    const mintQuote = {
      ...quoteMintFromPool({
        chainId: input.chainId,
        protocol: "V4",
        token0: nativeToken,
        token1: memeToken,
        fee: live.key.fee,
        tickSpacing: live.key.tickSpacing,
        sqrtPriceX96: live.sqrtPriceX96,
        tickCurrent: live.tick,
        pool: addresses.v4PoolManager,
        widthPct: input.market.rangeWidthPct,
        amount0Desired: nativeDesired,
        amount1Desired: memeDesired,
        useNative: true,
        nativeIsToken0: true,
      }),
      poolId: live.poolId,
      hooks: live.key.hooks,
    };
    mintTransactions = planMint(mintQuote, input.owner, false).txs;
    wrapAmount = swapIn;
    liquidityTargets = [addresses.v4PositionManager, addresses.permit2];
    custodyNotice = "The Uniswap V4 position NFT is minted directly to your wallet.";
    marketPlan = {
      marketId: input.market.id,
      symbol: input.market.symbol,
      protocol: "V4",
      pool: live.poolId,
      venue: "uniswap-v4",
      liquidityTarget: addresses.v4PositionManager,
      quoteSymbol: "ETH",
      budgetWei: input.net.toString(),
      swapInWei: swapIn.toString(),
      quotedMemeOut: acquisition.marketPlan.quotedMemeOut,
      minimumMemeOut: acquisition.marketPlan.minimumMemeOut,
      mintQuote: mintQuote.amount0.toString(),
      mintMeme: mintQuote.amount1.toString(),
      tickLower: mintQuote.tickLower,
      tickUpper: mintQuote.tickUpper,
      leftoverQuote: (quoteForMint - mintQuote.amount0).toString(),
      leftoverMeme: (memeFloor - mintQuote.amount1).toString(),
    };
  }

  const transactions: PlannedTx[] = [
    wrapEthTx(wrapAmount, input.chainId),
    erc20ApproveTx(addresses.weth, acquisition.swapSpender, swapIn),
    acquisition.swap,
    ...mintTransactions,
  ];
  const allowedTargets = uniqueAddresses([
    addresses.weth,
    input.market.token,
    acquisition.swapSpender,
    ...liquidityTargets,
  ]);
  assertAllowedTransactions(transactions, allowedTargets);
  const now = new Date();
  return {
    kind: "allocate",
    owner: input.owner,
    chain: input.chain,
    chainId: input.chainId,
    amountWei: input.amountWei.toString(),
    serviceFeeBps: 0,
    serviceFeeWei: "0",
    netAllocationWei: input.net.toString(),
    expectedConfirmations: 1,
    execution: "wallet_transactions",
    atomic: false,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PLAN_TTL_MS).toISOString(),
    markets: [marketPlan],
    transactions: transactions.map(serializeTx),
    allowedTargets,
    notices: [
      custodyNotice,
      "Your wallet confirms each step. Every completed step settles to your wallet, and Wizzy never takes custody.",
      "Quoted outputs and ranges expire. Re-plan instead of signing an expired plan.",
      "Any unused ETH, WETH, or meme tokens remain in your wallet.",
    ],
  };
}

async function quoteMarket(
  client: PublicClient,
  owner: Address,
  chainId: number,
  market: CuratedMarket,
  budget: bigint,
  useNative = false,
): Promise<MarketQuote> {
  return market.protocol === "AERODROME_SLIPSTREAM"
    ? quoteAerodromeMarket(client, owner, chainId, market, budget)
    : quoteUniswapMarket(client, owner, chainId, market, budget, useNative);
}

async function quoteUniswapMarket(
  client: PublicClient,
  owner: Address,
  chainId: number,
  market: CuratedMarket,
  budget: bigint,
  useNative = false,
): Promise<MarketQuote> {
  const swapIn = (budget * SWAP_SHARE_BPS) / BPS;
  const wethForMint = budget - swapIn;
  if (swapIn <= 0n || wethForMint <= 0n) throw new Error(`${market.id} allocation is too small`);

  const [token0Address, token1Address, quoteResult] = await Promise.all([
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
  const postSwapSqrtPriceX96 = quoteResult.result[1];
  const postSwapTick = tickAtSqrtPriceX96(postSwapSqrtPriceX96);
  const minimumMemeOut = (quotedMemeOut * (BPS - SWAP_SLIPPAGE_BPS)) / BPS;

  const quoteToken: TokenRef = { address: market.quoteToken, symbol: market.quoteSymbol, decimals: market.quoteDecimals };
  const memeToken: TokenRef = { address: market.token, symbol: market.symbol, decimals: market.tokenDecimals };
  const quoteIsToken0 = token0Address.toLowerCase() === market.quoteToken.toLowerCase();
  const token0 = quoteIsToken0 ? quoteToken : memeToken;
  const token1 = quoteIsToken0 ? memeToken : quoteToken;
  // The swap may settle anywhere between minimumMemeOut and quotedMemeOut.
  // Plan the mint against the guaranteed floor so the transaction plan does
  // not fail merely because the quote moved within the accepted slippage band.
  const amount0Desired = quoteIsToken0 ? wethForMint : minimumMemeOut;
  const amount1Desired = quoteIsToken0 ? minimumMemeOut : wethForMint;
  const mintQuote = quoteMintFromPool({
    chainId,
    protocol: "V3",
    token0,
    token1,
    fee: market.fee,
    tickSpacing: market.tickSpacing,
    // The swap executes before the mint and can materially move a thin pool.
    // Build the range and token ratio from the quoter's post-swap state.
    sqrtPriceX96: postSwapSqrtPriceX96,
    tickCurrent: postSwapTick,
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
    deadlineSec: WALLET_PLAN_DEADLINE_SEC,
    useNative,
  });
  const swap = exactInV3Tx({
    tokenIn: market.quoteToken,
    tokenOut: market.token,
    fee: market.fee,
    amountIn: swapIn,
    amountOutMin: minimumMemeOut,
    recipient: owner,
    payerIsUser: true,
    useNative,
    deadlineSec: WALLET_PLAN_DEADLINE_SEC,
    chainId,
  });

  return {
    market,
    marketPlan: {
      marketId: market.id,
      symbol: market.symbol,
      protocol: "V3",
      pool: market.pool,
      venue: "uniswap-v3",
      liquidityTarget: addressesFor(chainId === 4663 ? "robinhood" : "base").nfpm,
      quoteSymbol: useNative ? "ETH" : "WETH",
      budgetWei: budget.toString(),
      swapInWei: swapIn.toString(),
      quotedMemeOut: quotedMemeOut.toString(),
      minimumMemeOut: minimumMemeOut.toString(),
      mintQuote: mintWeth.toString(),
      mintMeme: mintMeme.toString(),
      tickLower: mintQuote.tickLower,
      tickUpper: mintQuote.tickUpper,
      leftoverQuote: (wethForMint - mintWeth).toString(),
      leftoverMeme: (minimumMemeOut - mintMeme).toString(),
    },
    swap,
    mint,
    swapSpender: addressesFor(chainId === 4663 ? "robinhood" : "base").swapRouter02,
    positionManager: addressesFor(chainId === 4663 ? "robinhood" : "base").nfpm,
    mintWeth,
    mintMeme,
  };
}

async function quoteAerodromeMarket(
  client: PublicClient,
  owner: Address,
  chainId: number,
  market: CuratedMarket,
  budget: bigint,
): Promise<MarketQuote> {
  if (chainId !== 8453 || !market.aerodromeDeployment) throw new Error(`${market.id} has no supported Aerodrome deployment`);
  const deployment = aerodromeDeployment(market.aerodromeDeployment);
  const swapIn = (budget * SWAP_SHARE_BPS) / BPS;
  const wethForMint = budget - swapIn;
  if (swapIn <= 0n || wethForMint <= 0n) throw new Error(`${market.id} allocation is too small`);
  const [token0Address, token1Address, factory, nft, liveFee, tickSpacing, quoteResult] = await Promise.all([
    client.readContract({ address: market.pool, abi: slipstreamPoolAbi, functionName: "token0" }),
    client.readContract({ address: market.pool, abi: slipstreamPoolAbi, functionName: "token1" }),
    client.readContract({ address: market.pool, abi: slipstreamPoolAbi, functionName: "factory" }),
    client.readContract({ address: market.pool, abi: slipstreamPoolAbi, functionName: "nft" }),
    client.readContract({ address: market.pool, abi: slipstreamPoolAbi, functionName: "fee" }),
    client.readContract({ address: market.pool, abi: slipstreamPoolAbi, functionName: "tickSpacing" }),
    client.simulateContract({
      address: deployment.quoter,
      abi: slipstreamQuoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [{
        tokenIn: market.quoteToken,
        tokenOut: market.token,
        amountIn: swapIn,
        tickSpacing: market.tickSpacing,
        sqrtPriceLimitX96: 0n,
      }],
    }),
  ]);
  const pair = new Set([token0Address.toLowerCase(), token1Address.toLowerCase()]);
  if (!pair.has(market.token.toLowerCase()) || !pair.has(market.quoteToken.toLowerCase())) {
    throw new Error(`${market.id} pool tokens do not match the curated pair`);
  }
  if (factory.toLowerCase() !== deployment.factory.toLowerCase()) throw new Error(`${market.id} uses an unexpected Aerodrome factory`);
  if (nft.toLowerCase() !== deployment.positionManager.toLowerCase()) throw new Error(`${market.id} uses an unexpected Aerodrome position manager`);
  if (tickSpacing !== market.tickSpacing) throw new Error(`${market.id} Aerodrome tick spacing changed`);
  const quotedMemeOut = quoteResult.result[0];
  if (quotedMemeOut <= 0n) throw new Error(`${market.id} returned no swap output`);
  const postSwapSqrtPriceX96 = quoteResult.result[1];
  const postSwapTick = tickAtSqrtPriceX96(postSwapSqrtPriceX96);
  const minimumMemeOut = (quotedMemeOut * (BPS - SWAP_SLIPPAGE_BPS)) / BPS;
  const quoteToken: TokenRef = { address: market.quoteToken, symbol: market.quoteSymbol, decimals: market.quoteDecimals };
  const memeToken: TokenRef = { address: market.token, symbol: market.symbol, decimals: market.tokenDecimals };
  const quoteIsToken0 = token0Address.toLowerCase() === market.quoteToken.toLowerCase();
  const token0 = quoteIsToken0 ? quoteToken : memeToken;
  const token1 = quoteIsToken0 ? memeToken : quoteToken;
  const amount0Desired = quoteIsToken0 ? wethForMint : minimumMemeOut;
  const amount1Desired = quoteIsToken0 ? minimumMemeOut : wethForMint;
  const mintQuote = quoteMintFromPool({
    chainId,
    protocol: "V3",
    token0,
    token1,
    fee: liveFee,
    tickSpacing,
    sqrtPriceX96: postSwapSqrtPriceX96,
    tickCurrent: postSwapTick,
    pool: market.pool,
    widthPct: market.rangeWidthPct,
    amount0Desired,
    amount1Desired,
  });
  const mintWeth = quoteIsToken0 ? mintQuote.amount0 : mintQuote.amount1;
  const mintMeme = quoteIsToken0 ? mintQuote.amount1 : mintQuote.amount0;
  const swap = exactInSlipstreamTx({
    router: deployment.swapRouter,
    tokenIn: market.quoteToken,
    tokenOut: market.token,
    tickSpacing,
    amountIn: swapIn,
    amountOutMin: minimumMemeOut,
    recipient: owner,
    deadlineSec: WALLET_PLAN_DEADLINE_SEC,
  });
  const mint = mintSlipstreamTx({
    positionManager: deployment.positionManager,
    token0: mintQuote.token0,
    token1: mintQuote.token1,
    tickSpacing,
    tickLower: mintQuote.tickLower,
    tickUpper: mintQuote.tickUpper,
    amount0: mintQuote.amount0,
    amount1: mintQuote.amount1,
    recipient: owner,
    slippageBps: Number(SWAP_SLIPPAGE_BPS),
    deadlineSec: WALLET_PLAN_DEADLINE_SEC,
  });
  return {
    market,
    marketPlan: {
      marketId: market.id,
      symbol: market.symbol,
      protocol: "V3",
      pool: market.pool,
      venue: "aerodrome-slipstream",
      liquidityTarget: deployment.positionManager,
      quoteSymbol: "WETH",
      budgetWei: budget.toString(),
      swapInWei: swapIn.toString(),
      quotedMemeOut: quotedMemeOut.toString(),
      minimumMemeOut: minimumMemeOut.toString(),
      mintQuote: mintWeth.toString(),
      mintMeme: mintMeme.toString(),
      tickLower: mintQuote.tickLower,
      tickUpper: mintQuote.tickUpper,
      leftoverQuote: (wethForMint - mintWeth).toString(),
      leftoverMeme: (minimumMemeOut - mintMeme).toString(),
    },
    swap,
    mint,
    swapSpender: deployment.swapRouter,
    positionManager: deployment.positionManager,
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

function groupedByAddress<T>(items: readonly T[], addressOf: (item: T) => Address): Array<[Address, T[]]> {
  const groups = new Map<string, [Address, T[]]>();
  for (const item of items) {
    const address = getAddress(addressOf(item));
    const key = address.toLowerCase();
    const group = groups.get(key) ?? [address, []];
    group[1].push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function assertAllowedTransactions(transactions: readonly PlannedTx[], allowedTargets: readonly Address[]): void {
  const allowed = new Set(allowedTargets.map((address) => address.toLowerCase()));
  for (const tx of transactions) {
    if (!allowed.has(tx.to.toLowerCase())) throw new Error(`Refuse unapproved transaction target ${tx.to}`);
    if (tx.data === "0x" && tx.value === 0n) throw new Error(`Refuse empty zero-value transaction to ${tx.to}`);
  }
}
