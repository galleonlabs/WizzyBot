import { getAddress, isAddress, type Address, type PublicClient } from "viem";
import { addressesFor, chainOf, type ChainSlug } from "../chains.js";
import { adapterFor } from "../core/protocols.js";
import { AerodromeSlipstreamAdapter } from "../aerodrome/positions.js";
import { AERODROME_DEPLOYMENTS, type AerodromeDeployment } from "../aerodrome/deployments.js";
import {
  burnSlipstreamTx,
  collectSlipstreamTx,
  decreaseSlipstreamTx,
  exactInSlipstreamTx,
  increaseSlipstreamTx,
  mintSlipstreamTx,
} from "../aerodrome/calldata.js";
import { slipstreamQuoterV2Abi } from "../aerodrome/abi.js";
import { loadEnv } from "../config/env.js";
import { recenterRangeForPreset, snapRange, tickAtSqrtPriceX96, type RangePreset } from "../core/ticks.js";
import { chainCatalog, type CuratedMarket } from "../markets/catalog.js";
import { makePublicClient } from "../signer/broadcast.js";
import type { PlannedTx, PositionSnapshot, Protocol, TokenRef } from "../types.js";
import {
  collectCalldata,
  decreaseCalldata,
  erc20ApproveTx,
  increaseCalldata,
  mintCalldata,
  unwrapEthTx,
  wrapEthTx,
} from "../uniswap/calldata.js";
import { exactInV3Tx } from "../uniswap/router.js";
import { v2AddFromPosition, v2ApprovePairTx, v2RemoveFromPosition } from "../uniswap/v2-calldata.js";
import { permit2ApproveTx, poolKeyFromPosition, v4BurnTx, v4ClaimFeesTx, v4Currency, v4DecreaseTx, v4IncreaseTx, v4MintTx } from "../uniswap/v4-calldata.js";
import { quoterV2Abi } from "../chain/abi.js";
import { amountsForPosition } from "../chain/positions.js";
import { fittedLiquidityAmounts, liquidityForAmounts } from "../core/hydrate.js";
import { planAllocation, type AllocationPlan, type SerializableTx } from "./allocation.js";
import { MAX_TICK, MIN_TICK, WALLET_PLAN_DEADLINE_SEC } from "../constants.js";

const PLAN_TTL_MS = 8 * 60_000;
const WITHDRAW_FEE_SAFETY_BPS = 9_800n;
const SETTLEMENT_SAFETY_BPS = 9_850n;
const BPS = 10_000n;
const WITHDRAW_SWAP_SLIPPAGE_BPS = 150n;
const MINT_SLIPPAGE_BPS = 150;
/** Swaps smaller than this share of the position value are dust and skipped. */
const MIN_SWAP_SHARE = 0.004;

export type PositionActionKind = "collect" | "compound" | "increase" | "decrease" | "rebalance" | "withdraw";
export type SettlementPreference = "eth" | "tokens";

export type PositionActionPlan = {
  kind: PositionActionKind;
  owner: Address;
  chain: ChainSlug;
  chainId: number;
  tokenId: string;
  pair: string;
  execution: "wallet_transactions";
  atomic: false;
  expectedConfirmations: 1;
  serviceFeeBps: number;
  serviceFee: Array<{ token: Address; symbol: string; amount: string }>;
  funding?: {
    amountWei: string;
    serviceFeeWei: string;
    netAmountWei: string;
    quoteSymbol: "ETH" | "WETH";
    quoteAmount: string;
    memeSymbol: string;
    memeAmount: string;
  };
  range?: {
    tickLower: number;
    tickUpper: number;
    currentTick: number;
    previousTickLower: number;
    previousTickUpper: number;
    preset?: RangePreset;
    swap?: { tokenIn: string; tokenOut: string; amountIn: string; minimumAmountOut: string };
  };
  removal?: { percent: number; amount0: string; amount1: string; burn: boolean };
  settlement?: { asset: "ETH"; minimumAmountWei: string; marketSymbol: string };
  tokens?: { symbol0: string; decimals0: number; symbol1: string; decimals1: number };
  transactions: SerializableTx[];
  allowedTargets: Address[];
  createdAt: string;
  expiresAt: string;
  notices: string[];
};

export type PositionActionInput = {
  owner: string;
  chain: ChainSlug;
  tokenId: bigint;
  action: PositionActionKind;
  amountWei?: bigint;
  percent?: number;
  protocol?: Protocol;
  venue?: "uniswap-v3" | "aerodrome-slipstream";
  positionManager?: string;
  rangePreset?: RangePreset;
  tickLower?: number;
  tickUpper?: number;
  settle?: SettlementPreference;
};

type SwapRoute =
  | { venue: "uniswap-v3"; router: Address; quoter: Address; fee: number; samePool: boolean }
  | { venue: "aerodrome-slipstream"; router: Address; quoter: Address; tickSpacing: number; samePool: boolean };

/** Everything an action needs to know about the pool, read from the position itself. */
export type PoolContext = {
  quoteIsToken0?: boolean;
  quote?: TokenRef;
  meme?: TokenRef;
  positionManager: Address;
  aerodrome?: AerodromeDeployment;
  swapRoute?: SwapRoute;
};

export type RebalanceSwapBase = {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minimumAmountOut: bigint;
  /** Present when the swap moves the position's own pool, so the mint is priced post-swap. */
  postSwapSqrtPriceX96?: bigint;
};

export type RebalanceSwap = RebalanceSwapBase & (
  | { venue: "uniswap-v3"; router: Address; fee: number }
  | { venue: "aerodrome-slipstream"; router: Address; tickSpacing: number }
);

export async function planPositionAction(input: PositionActionInput): Promise<PositionActionPlan> {
  if (!isAddress(input.owner)) throw new Error("owner must be a valid EVM address");
  const owner = getAddress(input.owner);
  const chain = chainOf(input.chain);
  const env = loadEnv();
  const client = makePublicClient(env.rpcByChain[input.chain], chain.viem);
  let snapshot: PositionSnapshot;
  if (input.venue === "aerodrome-slipstream") {
    if (input.chain !== "base" || !input.positionManager || !isAddress(input.positionManager)) {
      throw new Error("Aerodrome position manager is missing or invalid");
    }
    const deployment = aerodromeDeploymentFor(input.positionManager);
    if (!deployment) throw new Error("This Aerodrome position manager is not supported");
    snapshot = await new AerodromeSlipstreamAdapter(client, deployment.id).readPosition(input.tokenId);
  } else {
    const adapter = adapterFor(input.protocol ?? "V3", client);
    adapter.bindOwner?.(owner);
    snapshot = await adapter.readPosition(input.tokenId);
  }
  if (snapshot.owner.toLowerCase() !== owner.toLowerCase()) throw new Error("wallet does not own this position");
  const context = poolContext(snapshot, input.chain);
  const plan = await planForSnapshot(input, snapshot, owner, client, context);
  return {
    ...plan,
    tokens: { symbol0: snapshot.token0.symbol, decimals0: snapshot.token0.decimals, symbol1: snapshot.token1.symbol, decimals1: snapshot.token1.decimals },
  };
}

async function planForSnapshot(
  input: PositionActionInput,
  snapshot: PositionSnapshot,
  owner: Address,
  client: PublicClient,
  context: PoolContext,
): Promise<PositionActionPlan> {
  if (input.action === "increase") {
    if (!input.amountWei || input.amountWei <= 0n) throw new Error("Enter an ETH amount to add");
    if (snapshot.ref.protocol === "V2" || snapshot.ref.protocol === "V4") {
      const configured = catalogMarketFor(snapshot, input.chain);
      if (!configured) throw new Error(`Adding ETH to this ${snapshot.ref.protocol} pool is not supported yet`);
      const allocation = await planAllocation({
        owner,
        chain: input.chain,
        amountWei: input.amountWei,
        marketId: configured.id,
        protocol: snapshot.ref.protocol,
        client,
      });
      return buildIncreasePositionActionPlan(snapshot, allocation);
    }
    return planIncreaseFromEth(client, snapshot, owner, input.chain, context, input.amountWei);
  }
  if (input.action === "decrease") {
    return buildDecreasePositionActionPlan(snapshot, owner, input.chain, input.percent ?? 0);
  }
  if (input.action === "rebalance") {
    if (snapshot.ref.protocol === "V2") throw new Error("Uniswap V2 positions are already full range");
    if (snapshot.liquidity <= 0n) throw new Error("This position is already closed");
    const explicit = input.tickLower !== undefined && input.tickUpper !== undefined;
    const target = explicit
      ? targetRangeFromTicks(snapshot, input.tickLower!, input.tickUpper!)
      : recenterRangeForPreset(snapshot.tickLower, snapshot.tickUpper, snapshot.tickCurrent, snapshot.tickSpacing, input.rangePreset ?? "balanced");
    const available0 = ((snapshot.amount0 + snapshot.uncollected0) * WITHDRAW_FEE_SAFETY_BPS) / BPS;
    const available1 = ((snapshot.amount1 + snapshot.uncollected1) * WITHDRAW_FEE_SAFETY_BPS) / BPS;
    const wanted = planRangeSwap(snapshot, available0, available1, target.tickLower, target.tickUpper);
    let swap: RebalanceSwap | undefined;
    if (wanted) {
      if (!context.swapRoute) throw new Error("This pool has no supported swap route for a rebalance");
      const tokenIn = wanted.tokenIn === 0 ? snapshot.token0 : snapshot.token1;
      const tokenOut = wanted.tokenIn === 0 ? snapshot.token1 : snapshot.token0;
      swap = await quoteRouteSwap(client, context.swapRoute, tokenIn.address, tokenOut.address, wanted.amountIn);
    }
    return buildRebalancePositionActionPlan(snapshot, owner, input.chain, swap, explicit ? undefined : input.rangePreset ?? "balanced", explicit ? target : undefined);
  }
  const plan = buildPositionActionPlan(snapshot, owner, input.chain, input.action);
  if (input.action !== "withdraw") return plan;
  const wantsEth = (input.settle ?? "eth") === "eth";
  if (!wantsEth || !supportsEthSettlement(snapshot, context)) return plan;
  return addEthSettlement(client, plan, snapshot, context);
}

export function aerodromeDeploymentFor(positionManager: string): AerodromeDeployment | undefined {
  return Object.values(AERODROME_DEPLOYMENTS)
    .find((candidate) => candidate.positionManager.toLowerCase() === positionManager.toLowerCase());
}

function catalogMarketFor(snapshot: PositionSnapshot, chain: ChainSlug): CuratedMarket | undefined {
  return chainCatalog(chain).markets.find((market) => positionPoolIsConfigured(snapshot, [market]));
}

function isEthLike(token: TokenRef, chain: ChainSlug): boolean {
  const addresses = addressesFor(chain);
  const address = token.address.toLowerCase();
  return address === addresses.weth.toLowerCase() || address === addresses.nativeEth.toLowerCase();
}

/** Derive swap routing and the ETH side of the pair from the position itself, not the catalog. */
export function poolContext(snapshot: PositionSnapshot, chain: ChainSlug): PoolContext {
  const addresses = addressesFor(chain);
  const eth0 = isEthLike(snapshot.token0, chain);
  const eth1 = isEthLike(snapshot.token1, chain);
  const quoteIsToken0 = eth0 === eth1 ? undefined : eth0;
  const quote = quoteIsToken0 === undefined ? undefined : quoteIsToken0 ? snapshot.token0 : snapshot.token1;
  const meme = quoteIsToken0 === undefined ? undefined : quoteIsToken0 ? snapshot.token1 : snapshot.token0;
  const positionManager = managerFor(snapshot, chain);
  if (snapshot.venue === "aerodrome-slipstream") {
    const aerodrome = aerodromeDeploymentFor(positionManager);
    if (!aerodrome) throw new Error("This Aerodrome position manager is not supported");
    return {
      quoteIsToken0,
      quote,
      meme,
      positionManager,
      aerodrome,
      swapRoute: { venue: "aerodrome-slipstream", router: aerodrome.swapRouter, quoter: aerodrome.quoter, tickSpacing: snapshot.tickSpacing, samePool: true },
    };
  }
  if (snapshot.ref.protocol === "V3") {
    return {
      quoteIsToken0,
      quote,
      meme,
      positionManager,
      swapRoute: { venue: "uniswap-v3", router: addresses.swapRouter02, quoter: addresses.quoterV2, fee: snapshot.fee, samePool: true },
    };
  }
  if (snapshot.ref.protocol === "V4") {
    // V4 swaps are not routed directly yet; borrow the reviewed V3 or Slipstream pool for the same pair.
    const market = catalogMarketFor(snapshot, chain);
    let swapRoute: SwapRoute | undefined;
    if (market?.protocol === "AERODROME_SLIPSTREAM" && market.aerodromeDeployment) {
      const deployment = AERODROME_DEPLOYMENTS[market.aerodromeDeployment];
      swapRoute = { venue: "aerodrome-slipstream", router: deployment.swapRouter, quoter: deployment.quoter, tickSpacing: market.tickSpacing, samePool: false };
    } else if (market) {
      swapRoute = { venue: "uniswap-v3", router: addresses.swapRouter02, quoter: addresses.quoterV2, fee: market.fee, samePool: false };
    }
    return { quoteIsToken0, quote, meme, positionManager, swapRoute };
  }
  return { quoteIsToken0, quote, meme, positionManager };
}

export function supportsEthSettlement(snapshot: PositionSnapshot, context: PoolContext): boolean {
  if (snapshot.ref.protocol !== "V3" || context.quoteIsToken0 === undefined || !context.swapRoute) return false;
  return context.quote?.address.toLowerCase() === addressesFor(snapshot.ref.chainId === 4663 ? "robinhood" : "base").weth.toLowerCase();
}

export function buildIncreasePositionActionPlan(
  snapshot: PositionSnapshot,
  allocation: AllocationPlan,
): PositionActionPlan {
  if (snapshot.owner.toLowerCase() !== allocation.owner.toLowerCase()) throw new Error("wallet does not own this position");
  if (snapshot.ref.chainId !== allocation.chainId) throw new Error("position chain mismatch");
  if (snapshot.liquidity <= 0n) throw new Error("position is already closed");
  const market = allocation.markets[0];
  if (!market) throw new Error("allocation quote has no market");
  if (snapshot.ref.protocol !== market.protocol) throw new Error("allocation quote protocol does not match this position");
  const expectedPool = snapshot.ref.protocol === "V4" ? snapshot.poolId : snapshot.pool;
  if (!expectedPool || market.pool.toLowerCase() !== expectedPool.toLowerCase()) {
    throw new Error("allocation quote does not target this position's pool");
  }

  const weth = addressesFor(allocation.chain).weth.toLowerCase();
  const quoteIsToken0 = snapshot.token0.address.toLowerCase() === weth || snapshot.token0.symbol === "ETH";
  const quoteIsToken1 = snapshot.token1.address.toLowerCase() === weth || snapshot.token1.symbol === "ETH";
  if (quoteIsToken0 === quoteIsToken1) throw new Error("position does not contain exactly one ETH quote token");
  const quoteAmount = BigInt(market.mintQuote);
  const memeAmount = BigInt(market.mintMeme);
  const add0 = quoteIsToken0 ? quoteAmount : memeAmount;
  const add1 = quoteIsToken1 ? quoteAmount : memeAmount;
  if (add0 <= 0n && add1 <= 0n) throw new Error("allocation quote cannot add usable liquidity");

  const manager = managerFor(snapshot, allocation.chain);
  const fitted = snapshot.ref.protocol === "V2" ? null : fittedLiquidityAmounts(snapshot, add0, add1);
  if (fitted && fitted.liquidity <= 0n) throw new Error("allocation quote cannot add usable liquidity");
  const increase = snapshot.ref.protocol === "V2"
    ? v2AddFromPosition(snapshot, add0, add1, allocation.owner, MINT_SLIPPAGE_BPS)
    : snapshot.ref.protocol === "V4"
      ? v4IncreaseTx(snapshot, fitted!.liquidity, fitted!.amount0, fitted!.amount1, MINT_SLIPPAGE_BPS)
      : snapshot.venue === "aerodrome-slipstream"
        ? increaseSlipstreamTx({
            positionManager: manager,
            tokenId: snapshot.ref.tokenId,
            amount0: fitted!.amount0,
            amount1: fitted!.amount1,
            slippageBps: MINT_SLIPPAGE_BPS,
            deadlineSec: WALLET_PLAN_DEADLINE_SEC,
          })
        : increaseCalldata(
            snapshot,
            add0,
            add1,
            MINT_SLIPPAGE_BPS,
            WALLET_PLAN_DEADLINE_SEC,
            market.quoteSymbol === "ETH",
          );

  let replacedMint = false;
  const transactions = allocation.transactions.map((transaction) => {
    if (!isAllocationMint(transaction.description)) return deserialize(transaction);
    if (replacedMint) throw new Error("allocation quote contains more than one mint");
    replacedMint = true;
    return increase;
  });
  if (!replacedMint) throw new Error("allocation quote has no replaceable mint");
  const allowedTargets = uniqueAddresses([...allocation.allowedTargets, increase.to]);
  assertAllowed(transactions, allowedTargets);

  return {
    kind: "increase",
    owner: allocation.owner,
    chain: allocation.chain,
    chainId: allocation.chainId,
    tokenId: snapshot.ref.tokenId.toString(),
    pair: `${snapshot.token0.symbol}/${snapshot.token1.symbol}`,
    execution: "wallet_transactions",
    atomic: false,
    expectedConfirmations: 1,
    serviceFeeBps: allocation.serviceFeeBps,
    serviceFee: [],
    funding: {
      amountWei: allocation.amountWei,
      serviceFeeWei: allocation.serviceFeeWei,
      netAmountWei: allocation.netAllocationWei,
      quoteSymbol: market.quoteSymbol,
      quoteAmount: market.mintQuote,
      memeSymbol: market.symbol,
      memeAmount: market.mintMeme,
    },
    transactions: transactions.map(serialize),
    allowedTargets,
    createdAt: allocation.createdAt,
    expiresAt: allocation.expiresAt,
    notices: [
      "Fresh ETH is split into the two pool tokens and added to this exact position without changing its range.",
      "Every completed step settles to your wallet. Any token amount that does not fit the current range remains there.",
    ],
  };
}

function isAllocationMint(description: string): boolean {
  return description === "NFPM.mint"
    || description === "Aerodrome Slipstream mint"
    || description === "Router02.addLiquidity"
    || description === "Router02.addLiquidityETH"
    || description === "PositionManager.modifyLiquidities mint";
}

export type IncreaseSwapQuote = {
  amountIn: bigint;
  minimumAmountOut: bigint;
  postSwapSqrtPriceX96: bigint;
};

async function planIncreaseFromEth(
  client: PublicClient,
  snapshot: PositionSnapshot,
  owner: Address,
  chain: ChainSlug,
  context: PoolContext,
  budget: bigint,
): Promise<PositionActionPlan> {
  if (snapshot.liquidity <= 0n) throw new Error("This position is already closed");
  if (context.quoteIsToken0 === undefined || !context.quote || !context.meme || !context.swapRoute) {
    throw new Error("Adding ETH needs a pool paired with ETH");
  }
  const available0 = context.quoteIsToken0 ? budget : 0n;
  const available1 = context.quoteIsToken0 ? 0n : budget;
  const wanted = planRangeSwap(snapshot, available0, available1, snapshot.tickLower, snapshot.tickUpper);
  let quote: IncreaseSwapQuote = { amountIn: 0n, minimumAmountOut: 0n, postSwapSqrtPriceX96: snapshot.sqrtPriceX96 };
  if (wanted) {
    if (wanted.tokenIn !== (context.quoteIsToken0 ? 0 : 1)) throw new Error("Adding ETH cannot start from the pool token");
    const swap = await quoteRouteSwap(client, context.swapRoute, context.quote.address, context.meme.address, wanted.amountIn);
    quote = { amountIn: swap.amountIn, minimumAmountOut: swap.minimumAmountOut, postSwapSqrtPriceX96: swap.postSwapSqrtPriceX96 ?? snapshot.sqrtPriceX96 };
  }
  return buildIncreaseFromEthPlan(snapshot, owner, chain, context, budget, quote);
}

/** Zap fresh ETH into an existing V3 or Slipstream position through its own pool. */
export function buildIncreaseFromEthPlan(
  snapshot: PositionSnapshot,
  owner: Address,
  chain: ChainSlug,
  context: PoolContext,
  budget: bigint,
  swap: IncreaseSwapQuote,
): PositionActionPlan {
  if (snapshot.ref.protocol !== "V3") throw new Error("ETH zaps support Uniswap V3 and Aerodrome Slipstream positions");
  if (context.quoteIsToken0 === undefined || !context.quote || !context.meme || !context.swapRoute) {
    throw new Error("Adding ETH needs a pool paired with ETH");
  }
  if (budget <= 0n) throw new Error("Enter an ETH amount to add");
  if (swap.amountIn > budget) throw new Error("swap exceeds the ETH budget");
  const addresses = addressesFor(chain);
  const quoteForMint = budget - swap.amountIn;
  const memeForMint = swap.minimumAmountOut;
  const priced = swap.amountIn > 0n ? repriced(snapshot, swap.postSwapSqrtPriceX96) : snapshot;
  const add0 = context.quoteIsToken0 ? quoteForMint : memeForMint;
  const add1 = context.quoteIsToken0 ? memeForMint : quoteForMint;
  const fitted = fittedLiquidityAmounts(priced, add0, add1);
  if (fitted.liquidity <= 0n) throw new Error("This amount cannot add usable liquidity to the current range");
  const mintQuote = context.quoteIsToken0 ? fitted.amount0 : fitted.amount1;
  const mintMeme = context.quoteIsToken0 ? fitted.amount1 : fitted.amount0;
  const transactions: PlannedTx[] = [];
  const aerodrome = context.aerodrome;
  if (aerodrome) {
    transactions.push(wrapEthTx(budget, snapshot.ref.chainId));
    if (swap.amountIn > 0n) {
      transactions.push(
        erc20ApproveTx(context.quote.address, aerodrome.swapRouter, swap.amountIn),
        exactInSlipstreamTx({
          router: aerodrome.swapRouter,
          tokenIn: context.quote.address,
          tokenOut: context.meme.address,
          tickSpacing: snapshot.tickSpacing,
          amountIn: swap.amountIn,
          amountOutMin: swap.minimumAmountOut,
          recipient: owner,
          deadlineSec: WALLET_PLAN_DEADLINE_SEC,
        }),
      );
    }
    if (mintQuote > 0n) transactions.push(erc20ApproveTx(context.quote.address, context.positionManager, mintQuote + 1n));
    if (mintMeme > 0n) transactions.push(erc20ApproveTx(context.meme.address, context.positionManager, mintMeme + 1n));
    transactions.push(increaseSlipstreamTx({
      positionManager: context.positionManager,
      tokenId: snapshot.ref.tokenId,
      amount0: fitted.amount0,
      amount1: fitted.amount1,
      slippageBps: MINT_SLIPPAGE_BPS,
      deadlineSec: WALLET_PLAN_DEADLINE_SEC,
    }));
  } else {
    if (context.swapRoute.venue !== "uniswap-v3") throw new Error("Uniswap V3 positions swap through SwapRouter02");
    if (swap.amountIn > 0n) {
      transactions.push(exactInV3Tx({
        tokenIn: context.quote.address,
        tokenOut: context.meme.address,
        fee: context.swapRoute.fee,
        amountIn: swap.amountIn,
        amountOutMin: swap.minimumAmountOut,
        recipient: owner,
        payerIsUser: true,
        useNative: true,
        deadlineSec: WALLET_PLAN_DEADLINE_SEC,
        chainId: snapshot.ref.chainId,
      }));
    }
    if (mintMeme > 0n) transactions.push(erc20ApproveTx(context.meme.address, context.positionManager, mintMeme));
    transactions.push(increaseCalldata(priced, add0, add1, MINT_SLIPPAGE_BPS, WALLET_PLAN_DEADLINE_SEC, true));
  }
  const allowedTargets = uniqueAddresses([
    addresses.weth,
    context.meme.address,
    context.positionManager,
    ...(swap.amountIn > 0n ? [context.swapRoute.router] : []),
  ]);
  assertAllowed(transactions, allowedTargets);
  const now = new Date();
  return {
    kind: "increase",
    owner,
    chain,
    chainId: snapshot.ref.chainId,
    tokenId: snapshot.ref.tokenId.toString(),
    pair: `${snapshot.token0.symbol}/${snapshot.token1.symbol}`,
    execution: "wallet_transactions",
    atomic: false,
    expectedConfirmations: 1,
    serviceFeeBps: 0,
    serviceFee: [],
    funding: {
      amountWei: budget.toString(),
      serviceFeeWei: "0",
      netAmountWei: budget.toString(),
      quoteSymbol: aerodrome ? "WETH" : "ETH",
      quoteAmount: mintQuote.toString(),
      memeSymbol: context.meme.symbol,
      memeAmount: mintMeme.toString(),
    },
    transactions: transactions.map(serialize),
    allowedTargets,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PLAN_TTL_MS).toISOString(),
    notices: [
      `Your ETH is split to match the position's current range, swapped through the ${aerodrome ? "Aerodrome" : "Uniswap"} pool, and added to this exact NFT.`,
      "Every completed step settles to your wallet. Any token amount that does not fit the range remains there.",
      "The swap carries 1.5% slippage protection and the pool fee only. Wizzy charges nothing.",
    ],
  };
}

async function addEthSettlement(
  client: PublicClient,
  plan: PositionActionPlan,
  snapshot: PositionSnapshot,
  context: PoolContext,
): Promise<PositionActionPlan> {
  if (!context.swapRoute || !context.meme || context.quoteIsToken0 === undefined) throw new Error("This position cannot settle to ETH");
  const memeToSwap = (((context.quoteIsToken0 ? snapshot.amount1 + snapshot.uncollected1 : snapshot.amount0 + snapshot.uncollected0)) * SETTLEMENT_SAFETY_BPS) / BPS;
  let minimumSwapOut = 0n;
  if (memeToSwap > 0n) {
    const quote = await quoteRouteSwap(client, context.swapRoute, context.meme.address, context.quote!.address, memeToSwap);
    minimumSwapOut = quote.minimumAmountOut;
  }
  return buildEthSettlement(plan, snapshot, context, { memeToSwap, minimumSwapOut });
}

/** Append the meme → WETH swap and unwrap so a full exit lands as native ETH. */
export function buildEthSettlement(
  plan: PositionActionPlan,
  snapshot: PositionSnapshot,
  context: PoolContext,
  quote: { memeToSwap: bigint; minimumSwapOut: bigint },
): PositionActionPlan {
  if (!context.swapRoute || !context.meme || !context.quote || context.quoteIsToken0 === undefined) {
    throw new Error("This position cannot settle to ETH");
  }
  const chainId = snapshot.ref.chainId;
  const wethFloor = (((context.quoteIsToken0 ? snapshot.amount0 + snapshot.uncollected0 : snapshot.amount1 + snapshot.uncollected1)) * SETTLEMENT_SAFETY_BPS) / BPS;
  if (wethFloor === 0n && quote.memeToSwap === 0n) throw new Error("This position is too small to withdraw to ETH");
  const settlementTransactions: PlannedTx[] = [];
  if (quote.memeToSwap > 0n) {
    if (quote.minimumSwapOut <= 0n) throw new Error("The pool returned no usable ETH withdrawal quote");
    settlementTransactions.push(
      erc20ApproveTx(context.meme.address, context.swapRoute.router, quote.memeToSwap),
      context.swapRoute.venue === "aerodrome-slipstream"
        ? exactInSlipstreamTx({
            router: context.swapRoute.router,
            tokenIn: context.meme.address,
            tokenOut: context.quote.address,
            tickSpacing: context.swapRoute.tickSpacing,
            amountIn: quote.memeToSwap,
            amountOutMin: quote.minimumSwapOut,
            recipient: plan.owner,
            deadlineSec: WALLET_PLAN_DEADLINE_SEC,
          })
        : exactInV3Tx({
            tokenIn: context.meme.address,
            tokenOut: context.quote.address,
            fee: context.swapRoute.fee,
            amountIn: quote.memeToSwap,
            amountOutMin: quote.minimumSwapOut,
            recipient: plan.owner,
            chainId,
          }),
    );
  }
  const minimumEth = wethFloor + (quote.memeToSwap > 0n ? quote.minimumSwapOut : 0n);
  settlementTransactions.push(unwrapEthTx(minimumEth, chainId));
  const transactions = [...plan.transactions, ...settlementTransactions.map(serialize)];
  const allowedTargets = uniqueAddresses([...plan.allowedTargets, context.swapRoute.router, context.quote.address, context.meme.address]);
  assertAllowed(transactions.map(deserialize), allowedTargets);
  return {
    ...plan,
    transactions,
    allowedTargets,
    settlement: { asset: "ETH", minimumAmountWei: minimumEth.toString(), marketSymbol: context.meme.symbol },
    notices: [
      `Your ${context.meme.symbol} position closes and converts to native ETH through wallet-confirmed steps.`,
      "Each confirmed step settles to your wallet. If a later step fails, Wizzy never holds the remaining assets.",
      "The quote includes 1.5% swap protection. Small execution surplus or token dust remains in your wallet.",
    ],
  };
}

export function positionPoolIsConfigured(
  snapshot: PositionSnapshot,
  markets: readonly CuratedMarket[],
): boolean {
  return markets.some((market) => {
    const tokens = new Set([snapshot.token0.address.toLowerCase(), snapshot.token1.address.toLowerCase()]);
    const pairMatches = tokens.has(market.token.toLowerCase()) && tokens.has(market.quoteToken.toLowerCase());
    if (snapshot.ref.protocol === "V2" || snapshot.ref.protocol === "V4") return pairMatches;
    return market.pool.toLowerCase() === snapshot.pool.toLowerCase()
      && (snapshot.venue === "aerodrome-slipstream") === (market.protocol === "AERODROME_SLIPSTREAM");
  });
}

export function buildPositionActionPlan(
  snapshot: PositionSnapshot,
  owner: Address,
  chain: ChainSlug,
  action: "collect" | "compound" | "rebalance" | "withdraw",
): PositionActionPlan {
  if (snapshot.ref.chainId !== chainOf(chain).id) throw new Error("position chain mismatch");
  if (snapshot.owner.toLowerCase() !== owner.toLowerCase()) throw new Error("wallet does not own this position");

  if (action === "rebalance") throw new Error("rebalance requires a live swap quote");
  const { transactions, targets } = protocolTransactions(snapshot, owner, chain, action);
  const allowedTargets = uniqueAddresses([
    ...targets,
    snapshot.token0.address,
    snapshot.token1.address,
  ]);
  assertAllowed(transactions, allowedTargets);

  const now = new Date();
  return {
    kind: action,
    owner,
    chain,
    chainId: snapshot.ref.chainId,
    tokenId: snapshot.ref.tokenId.toString(),
    pair: `${snapshot.token0.symbol}/${snapshot.token1.symbol}`,
    execution: "wallet_transactions",
    atomic: false,
    expectedConfirmations: 1,
    serviceFeeBps: 0,
    serviceFee: [],
    ...(action === "withdraw" ? { removal: { percent: 100, amount0: snapshot.amount0.toString(), amount1: snapshot.amount1.toString(), burn: snapshot.ref.protocol !== "V2" } } : {}),
    transactions: transactions.map(serialize),
    allowedTargets,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PLAN_TTL_MS).toISOString(),
    notices: action === "collect"
      ? [
          "All claimable fees return directly to your wallet. Wizzy does not charge for collection.",
          "Your liquidity and price range stay unchanged.",
        ]
      : action === "compound"
      ? [
          "All claimable fees are collected and added to the same self-custodied NFT. Wizzy does not charge for reinvesting them.",
          "No swap is forced: any token amount that does not fit the current range ratio remains in your wallet.",
        ]
      : snapshot.ref.protocol === "V2"
        ? [
            "Your LP tokens are redeemed and both underlying pool tokens return to your wallet.",
            "Wizzy does not charge for withdrawing. Re-plan if this quote expires.",
          ]
      : [
          "The full position is removed and the empty NFT is burned during the wallet transaction sequence.",
          "You receive both underlying pool tokens. Consolidating them to ETH is a separate quoted action so no hidden swap is taken.",
          "Wizzy does not charge for withdrawing. Re-plan if this quote expires.",
        ],
  };
}

/** Remove part of a position. Fees owed are collected alongside the removed principal. */
export function buildDecreasePositionActionPlan(
  snapshot: PositionSnapshot,
  owner: Address,
  chain: ChainSlug,
  percent: number,
): PositionActionPlan {
  if (snapshot.ref.chainId !== chainOf(chain).id) throw new Error("position chain mismatch");
  if (snapshot.owner.toLowerCase() !== owner.toLowerCase()) throw new Error("wallet does not own this position");
  if (!Number.isInteger(percent) || percent < 1 || percent > 99) throw new Error("Choose between 1% and 99% to remove, or exit the position instead");
  if (snapshot.liquidity <= 0n) throw new Error("This position is already closed");
  if (snapshot.ref.protocol === "V2") throw new Error("Partial removal is not available for Uniswap V2 positions yet");
  const share = BigInt(percent);
  const liquidity = (snapshot.liquidity * share) / 100n;
  if (liquidity <= 0n) throw new Error("This share is too small to remove");
  const amount0 = (snapshot.amount0 * share) / 100n;
  const amount1 = (snapshot.amount1 * share) / 100n;
  const manager = managerFor(snapshot, chain);
  const addresses = addressesFor(chain);
  let transactions: PlannedTx[];
  let targets: Address[];
  if (snapshot.ref.protocol === "V4") {
    transactions = [v4DecreaseTx({ ...snapshot, amount0, amount1 }, liquidity, owner, MINT_SLIPPAGE_BPS)];
    targets = [addresses.v4PositionManager];
  } else if (snapshot.venue === "aerodrome-slipstream") {
    transactions = [
      decreaseSlipstreamTx({
        positionManager: manager,
        tokenId: snapshot.ref.tokenId,
        liquidity,
        amount0Min: (amount0 * (BPS - WITHDRAW_SWAP_SLIPPAGE_BPS)) / BPS,
        amount1Min: (amount1 * (BPS - WITHDRAW_SWAP_SLIPPAGE_BPS)) / BPS,
        deadlineSec: WALLET_PLAN_DEADLINE_SEC,
        percent,
      }),
      collectSlipstreamTx(manager, snapshot.ref.tokenId, owner),
    ];
    targets = [manager];
  } else {
    transactions = [decreaseCalldata(snapshot, percent, owner, MINT_SLIPPAGE_BPS, WALLET_PLAN_DEADLINE_SEC, false)];
    targets = [manager];
  }
  const allowedTargets = uniqueAddresses([...targets, snapshot.token0.address, snapshot.token1.address]);
  assertAllowed(transactions, allowedTargets);
  const now = new Date();
  return {
    kind: "decrease",
    owner,
    chain,
    chainId: snapshot.ref.chainId,
    tokenId: snapshot.ref.tokenId.toString(),
    pair: `${snapshot.token0.symbol}/${snapshot.token1.symbol}`,
    execution: "wallet_transactions",
    atomic: false,
    expectedConfirmations: 1,
    serviceFeeBps: 0,
    serviceFee: [],
    removal: { percent, amount0: amount0.toString(), amount1: amount1.toString(), burn: false },
    transactions: transactions.map(serialize),
    allowedTargets,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PLAN_TTL_MS).toISOString(),
    notices: [
      `${percent}% of the liquidity returns to your wallet as both pool tokens, together with any fees owed.`,
      "The range and the remaining liquidity stay exactly as they are. Wizzy charges nothing.",
    ],
  };
}

function protocolTransactions(
  snapshot: PositionSnapshot,
  owner: Address,
  chain: ChainSlug,
  action: "collect" | "compound" | "withdraw",
): { transactions: PlannedTx[]; targets: Address[] } {
  if (snapshot.ref.protocol === "V2") {
    if (action !== "withdraw") throw new Error("Uniswap V2 fees are already reinvested in the LP token");
    const router = addressesFor(chain).v2Router;
    return { transactions: [
      v2ApprovePairTx(snapshot.pool, snapshot.liquidity, snapshot.ref.chainId),
      v2RemoveFromPosition(snapshot, owner, 100, MINT_SLIPPAGE_BPS),
    ], targets: [router, snapshot.pool] };
  }

  if (snapshot.ref.protocol === "V4") {
    const addresses = addressesFor(chain);
    if (action === "withdraw") {
      return { transactions: [v4BurnTx(snapshot, owner, MINT_SLIPPAGE_BPS)], targets: [addresses.v4PositionManager] };
    }
    if (action === "collect") {
      if (snapshot.uncollected0 <= 0n && snapshot.uncollected1 <= 0n) throw new Error("No fees are ready to collect");
      return { transactions: [v4ClaimFeesTx(snapshot, owner)], targets: [addresses.v4PositionManager] };
    }
    const add0 = snapshot.uncollected0;
    const add1 = snapshot.uncollected1;
    const liquidity = liquidityForAmounts(snapshot, add0, add1);
    if (liquidity <= 0n) throw new Error("No usable fees are ready to compound");
    const transactions: PlannedTx[] = [v4ClaimFeesTx(snapshot, owner)];
    for (const [token, amount] of [[snapshot.token0, add0], [snapshot.token1, add1]] as const) {
      if (amount <= 0n || (token.symbol === "ETH" && token.address.toLowerCase() === addresses.weth.toLowerCase())) continue;
      transactions.push(
        erc20ApproveTx(token.address, addresses.permit2, amount),
        permit2ApproveTx(token.address, addresses.v4PositionManager, amount, undefined, snapshot.ref.chainId),
      );
    }
    transactions.push(v4IncreaseTx(snapshot, liquidity, add0, add1, MINT_SLIPPAGE_BPS));
    return { transactions, targets: [addresses.v4PositionManager, addresses.permit2] };
  }

  const manager = managerFor(snapshot, chain);
  if (action === "collect") {
    if (snapshot.uncollected0 <= 0n && snapshot.uncollected1 <= 0n) throw new Error("No fees are ready to collect");
    return {
      transactions: [snapshot.venue === "aerodrome-slipstream"
        ? collectSlipstreamTx(manager, snapshot.ref.tokenId, owner)
        : collectCalldata(snapshot, owner)],
      targets: [manager],
    };
  }
  return {
    transactions: action === "compound"
      ? compoundTransactions(snapshot, owner)
      : withdrawTransactions(snapshot, owner),
    targets: [manager],
  };
}

async function quoteRouteSwap(
  client: PublicClient,
  route: SwapRoute,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
): Promise<RebalanceSwap> {
  if (amountIn <= 0n) throw new Error("swap amount must be positive");
  if (route.venue === "aerodrome-slipstream") {
    const quote = await client.simulateContract({
      address: route.quoter,
      abi: slipstreamQuoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn, tickSpacing: route.tickSpacing, sqrtPriceLimitX96: 0n }],
    });
    const minimumAmountOut = (quote.result[0] * (BPS - WITHDRAW_SWAP_SLIPPAGE_BPS)) / BPS;
    if (minimumAmountOut <= 0n) throw new Error("The pool returned no usable swap quote");
    return {
      venue: "aerodrome-slipstream",
      router: route.router,
      tokenIn,
      tokenOut,
      amountIn,
      minimumAmountOut,
      tickSpacing: route.tickSpacing,
      postSwapSqrtPriceX96: route.samePool ? quote.result[1] : undefined,
    };
  }
  const quote = await client.simulateContract({
    address: route.quoter,
    abi: quoterV2Abi,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn, fee: route.fee, sqrtPriceLimitX96: 0n }],
  });
  const minimumAmountOut = (quote.result[0] * (BPS - WITHDRAW_SWAP_SLIPPAGE_BPS)) / BPS;
  if (minimumAmountOut <= 0n) throw new Error("The pool returned no usable swap quote");
  return {
    venue: "uniswap-v3",
    router: route.router,
    tokenIn,
    tokenOut,
    amountIn,
    minimumAmountOut,
    fee: route.fee,
    postSwapSqrtPriceX96: route.samePool ? quote.result[1] : undefined,
  };
}

/**
 * How much of one token must be swapped so the wallet's token mix funds the
 * target range with minimal leftover. Uses the pool's live price and fee.
 * Returns undefined when the mix already fits or the imbalance is dust.
 */
export function planRangeSwap(
  snapshot: PositionSnapshot,
  available0: bigint,
  available1: bigint,
  tickLower: number,
  tickUpper: number,
): { tokenIn: 0 | 1; amountIn: bigint } | undefined {
  if (available0 <= 0n && available1 <= 0n) return undefined;
  const sqrt = Number(snapshot.sqrtPriceX96) / 2 ** 96;
  const price = sqrt * sqrt;
  if (!Number.isFinite(price) || price <= 0) return undefined;
  const unit = amountsForPosition({
    chainId: snapshot.ref.chainId,
    token0: snapshot.token0,
    token1: snapshot.token1,
    fee: snapshot.fee,
    tickSpacing: snapshot.tickSpacing,
    sqrtPriceX96: snapshot.sqrtPriceX96,
    tickCurrent: snapshot.tickCurrent,
    tickLower,
    tickUpper,
    liquidity: 10n ** 24n,
  });
  const unit0 = Number(unit.amount0);
  const unit1 = Number(unit.amount1);
  const unitValue = unit1 + unit0 * price;
  if (!(unitValue > 0)) return undefined;
  const share1 = unit1 / unitValue;
  const fee = Math.min(0.5, Math.max(0, snapshot.fee / 1_000_000));
  const have0 = Number(available0);
  const have1 = Number(available1);
  const totalValue = have1 + have0 * price;
  if (!(totalValue > 0)) return undefined;
  const imbalance = (1 - share1) * have1 - share1 * have0 * price;
  if (Math.abs(imbalance) / totalValue < MIN_SWAP_SHARE) return undefined;
  if (imbalance > 0) {
    const amountIn = BigInt(Math.floor(imbalance / (1 - share1 * fee)));
    return amountIn > 0n ? { tokenIn: 1, amountIn: amountIn > available1 ? available1 : amountIn } : undefined;
  }
  const amountIn = BigInt(Math.floor(-imbalance / (price * (1 - (1 - share1) * fee))));
  return amountIn > 0n ? { tokenIn: 0, amountIn: amountIn > available0 ? available0 : amountIn } : undefined;
}

export function targetRangeFromTicks(
  snapshot: Pick<PositionSnapshot, "tickSpacing" | "tickLower" | "tickUpper">,
  tickLower: number,
  tickUpper: number,
): { tickLower: number; tickUpper: number } {
  if (!Number.isInteger(tickLower) || !Number.isInteger(tickUpper)) throw new Error("Range ticks must be integers");
  if (tickLower < MIN_TICK || tickUpper > MAX_TICK) throw new Error("Range is outside the pool's tick bounds");
  if (tickLower >= tickUpper) throw new Error("The minimum price must be below the maximum price");
  const snapped = snapRange(tickLower, tickUpper, snapshot.tickSpacing);
  if (snapped.tickLower === snapshot.tickLower && snapped.tickUpper === snapshot.tickUpper) {
    throw new Error("Choose a range that differs from the current one");
  }
  return snapped;
}

function repriced(snapshot: PositionSnapshot, sqrtPriceX96: bigint): PositionSnapshot {
  if (sqrtPriceX96 <= 0n || sqrtPriceX96 === snapshot.sqrtPriceX96) return snapshot;
  return { ...snapshot, sqrtPriceX96, tickCurrent: tickAtSqrtPriceX96(sqrtPriceX96) };
}

export function buildRebalancePositionActionPlan(
  snapshot: PositionSnapshot,
  owner: Address,
  chain: ChainSlug,
  swap?: RebalanceSwap,
  rangePreset: RangePreset | undefined = "balanced",
  targetRange?: { tickLower: number; tickUpper: number },
): PositionActionPlan {
  if (snapshot.ref.protocol === "V2") throw new Error("Uniswap V2 positions are already full range");
  const available0 = ((snapshot.amount0 + snapshot.uncollected0) * WITHDRAW_FEE_SAFETY_BPS) / BPS;
  const available1 = ((snapshot.amount1 + snapshot.uncollected1) * WITHDRAW_FEE_SAFETY_BPS) / BPS;
  let add0 = available0;
  let add1 = available1;
  if (add0 < 0n || add1 < 0n || (add0 === 0n && add1 === 0n)) throw new Error("position is too small to rebalance");
  if (swap) {
    if (swap.tokenIn.toLowerCase() === snapshot.token0.address.toLowerCase() && swap.tokenOut.toLowerCase() === snapshot.token1.address.toLowerCase()) {
      if (swap.amountIn > add0) throw new Error("rebalance swap exceeds available token amount");
      add0 -= swap.amountIn;
      add1 += swap.minimumAmountOut;
    } else if (swap.tokenIn.toLowerCase() === snapshot.token1.address.toLowerCase() && swap.tokenOut.toLowerCase() === snapshot.token0.address.toLowerCase()) {
      if (swap.amountIn > add1) throw new Error("rebalance swap exceeds available token amount");
      add1 -= swap.amountIn;
      add0 += swap.minimumAmountOut;
    } else {
      throw new Error("rebalance swap tokens do not match the position");
    }
  }
  const preset = targetRange ? undefined : rangePreset ?? "balanced";
  const resolvedRange = targetRange ?? recenterRangeForPreset(
    snapshot.tickLower,
    snapshot.tickUpper,
    snapshot.tickCurrent,
    snapshot.tickSpacing,
    preset!,
  );
  const range: NonNullable<PositionActionPlan["range"]> = {
    ...resolvedRange,
    currentTick: snapshot.tickCurrent,
    previousTickLower: snapshot.tickLower,
    previousTickUpper: snapshot.tickUpper,
    ...(preset ? { preset } : {}),
    ...(swap ? {
      swap: {
        tokenIn: swap.tokenIn.toLowerCase() === snapshot.token0.address.toLowerCase() ? snapshot.token0.symbol : snapshot.token1.symbol,
        tokenOut: swap.tokenOut.toLowerCase() === snapshot.token0.address.toLowerCase() ? snapshot.token0.symbol : snapshot.token1.symbol,
        amountIn: swap.amountIn.toString(),
        minimumAmountOut: swap.minimumAmountOut.toString(),
      },
    } : {}),
  };
  const mintSnapshot = swap?.postSwapSqrtPriceX96 ? repriced(snapshot, swap.postSwapSqrtPriceX96) : snapshot;
  const positionManager = managerFor(snapshot, chain);
  const addresses = addressesFor(chain);
  const aerodrome = snapshot.venue === "aerodrome-slipstream";
  const transactions: PlannedTx[] = snapshot.ref.protocol === "V4"
    ? [v4BurnTx(snapshot, owner, MINT_SLIPPAGE_BPS)]
    : aerodrome
      ? [
          decreaseSlipstreamTx({
            positionManager,
            tokenId: snapshot.ref.tokenId,
            liquidity: snapshot.liquidity,
            amount0Min: (snapshot.amount0 * (BPS - WITHDRAW_SWAP_SLIPPAGE_BPS)) / BPS,
            amount1Min: (snapshot.amount1 * (BPS - WITHDRAW_SWAP_SLIPPAGE_BPS)) / BPS,
            deadlineSec: WALLET_PLAN_DEADLINE_SEC,
          }),
          collectSlipstreamTx(positionManager, snapshot.ref.tokenId, owner),
          burnSlipstreamTx(positionManager, snapshot.ref.tokenId),
        ]
    : [decreaseCalldata(snapshot, 100, owner, MINT_SLIPPAGE_BPS, WALLET_PLAN_DEADLINE_SEC, true)];
  if (swap) {
    const inputToken = swap.tokenIn.toLowerCase() === snapshot.token0.address.toLowerCase() ? snapshot.token0 : snapshot.token1;
    const outputToken = swap.tokenOut.toLowerCase() === snapshot.token0.address.toLowerCase() ? snapshot.token0 : snapshot.token1;
    if (snapshot.ref.protocol === "V4" && v4Currency(inputToken, snapshot.ref.chainId).toLowerCase() === addresses.nativeEth.toLowerCase()) {
      transactions.push(wrapEthTx(swap.amountIn, snapshot.ref.chainId));
    }
    transactions.push(erc20ApproveTx(swap.tokenIn, swap.router, swap.amountIn));
    transactions.push(swap.venue === "aerodrome-slipstream"
      ? exactInSlipstreamTx({
          router: swap.router,
          tokenIn: swap.tokenIn,
          tokenOut: swap.tokenOut,
          tickSpacing: swap.tickSpacing,
          amountIn: swap.amountIn,
          amountOutMin: swap.minimumAmountOut,
          recipient: owner,
          deadlineSec: WALLET_PLAN_DEADLINE_SEC,
        })
      : exactInV3Tx({
        tokenIn: swap.tokenIn,
        tokenOut: swap.tokenOut,
        fee: swap.fee,
        amountIn: swap.amountIn,
        amountOutMin: swap.minimumAmountOut,
        recipient: owner,
        chainId: snapshot.ref.chainId,
      }));
    if (snapshot.ref.protocol === "V4" && v4Currency(outputToken, snapshot.ref.chainId).toLowerCase() === addresses.nativeEth.toLowerCase()) {
      transactions.push(unwrapEthTx(swap.minimumAmountOut, snapshot.ref.chainId));
    }
  }
  if (snapshot.ref.protocol === "V4") {
    const liquidity = liquidityForAmounts(mintSnapshot, add0, add1, range.tickLower, range.tickUpper);
    if (liquidity <= 0n) throw new Error("The rebalance quote cannot open usable V4 liquidity");
    for (const [token, amount] of [[snapshot.token0, add0], [snapshot.token1, add1]] as const) {
      if (amount <= 0n || v4Currency(token, snapshot.ref.chainId).toLowerCase() === addresses.nativeEth.toLowerCase()) continue;
      transactions.push(
        erc20ApproveTx(token.address, addresses.permit2, amount),
        permit2ApproveTx(token.address, addresses.v4PositionManager, amount, undefined, snapshot.ref.chainId),
      );
    }
    transactions.push(v4MintTx({
      poolKey: poolKeyFromPosition(snapshot),
      tickLower: range.tickLower,
      tickUpper: range.tickUpper,
      liquidity,
      amount0: add0,
      amount1: add1,
      recipient: owner,
      slippageBps: MINT_SLIPPAGE_BPS,
      deadlineSec: WALLET_PLAN_DEADLINE_SEC,
      chainId: snapshot.ref.chainId,
    }));
  } else if (aerodrome) {
    if (add0 > 0n) transactions.push(erc20ApproveTx(snapshot.token0.address, positionManager, add0 + 1n));
    if (add1 > 0n) transactions.push(erc20ApproveTx(snapshot.token1.address, positionManager, add1 + 1n));
    transactions.push(mintSlipstreamTx({
      positionManager,
      token0: snapshot.token0.address,
      token1: snapshot.token1.address,
      tickSpacing: snapshot.tickSpacing,
      tickLower: range.tickLower,
      tickUpper: range.tickUpper,
      amount0: add0,
      amount1: add1,
      recipient: owner,
      slippageBps: MINT_SLIPPAGE_BPS,
      deadlineSec: WALLET_PLAN_DEADLINE_SEC,
    }));
  } else {
    if (add0 > 0n) transactions.push(erc20ApproveTx(snapshot.token0.address, positionManager, add0));
    if (add1 > 0n) transactions.push(erc20ApproveTx(snapshot.token1.address, positionManager, add1));
    transactions.push(mintCalldata({
      position: mintSnapshot,
      tickLower: range.tickLower,
      tickUpper: range.tickUpper,
      amount0: add0,
      amount1: add1,
      recipient: owner,
      slippageBps: MINT_SLIPPAGE_BPS,
      deadlineSec: WALLET_PLAN_DEADLINE_SEC,
    }));
  }
  const allowedTargets = uniqueAddresses([
    positionManager,
    snapshot.token0.address,
    snapshot.token1.address,
    ...(snapshot.ref.protocol === "V4" ? [addresses.permit2] : []),
    ...(swap ? [swap.router] : []),
  ]);
  assertAllowed(transactions, allowedTargets);
  const now = new Date();
  const rangeLabel = preset ? `${preset} range` : "custom range";
  return {
    kind: "rebalance",
    owner,
    chain,
    chainId: snapshot.ref.chainId,
    tokenId: snapshot.ref.tokenId.toString(),
    pair: `${snapshot.token0.symbol}/${snapshot.token1.symbol}`,
    execution: "wallet_transactions",
    atomic: false,
    expectedConfirmations: 1,
    serviceFeeBps: 0,
    serviceFee: [],
    range,
    transactions: transactions.map(serialize),
    allowedTargets,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PLAN_TTL_MS).toISOString(),
    notices: [
      `Your current ${aerodrome ? "Aerodrome Slipstream" : snapshot.ref.protocol} position closes and a new ${rangeLabel} opens through wallet-confirmed steps.`,
      "Every completed step settles to your wallet. If a later step fails, Wizzy never holds the recovered pool assets.",
      swap
        ? "Part of the position is swapped so both tokens fit the new range. Any amount that does not fit remains in your wallet."
        : "No swap is needed: the current token mix already fits the new range. Any amount that does not fit remains in your wallet.",
    ],
  };
}

function compoundTransactions(
  snapshot: PositionSnapshot,
  owner: Address,
): PlannedTx[] {
  const add0 = snapshot.uncollected0;
  const add1 = snapshot.uncollected1;
  if (add0 <= 0n && add1 <= 0n) throw new Error("no uncollected fees to compound");
  const nfpm = managerFor(snapshot);
  const aerodrome = snapshot.venue === "aerodrome-slipstream";
  const txs: PlannedTx[] = [aerodrome
    ? collectSlipstreamTx(nfpm, snapshot.ref.tokenId, owner)
    : collectCalldata(snapshot, owner)];
  if (add0 > 0n) txs.push(erc20ApproveTx(snapshot.token0.address, nfpm, aerodrome ? add0 + 1n : add0));
  if (add1 > 0n) txs.push(erc20ApproveTx(snapshot.token1.address, nfpm, aerodrome ? add1 + 1n : add1));
  txs.push(aerodrome
    ? increaseSlipstreamTx({
        positionManager: nfpm,
        tokenId: snapshot.ref.tokenId,
        amount0: add0,
        amount1: add1,
        slippageBps: MINT_SLIPPAGE_BPS,
        deadlineSec: WALLET_PLAN_DEADLINE_SEC,
      })
    : increaseCalldata(snapshot, add0, add1, MINT_SLIPPAGE_BPS, WALLET_PLAN_DEADLINE_SEC));
  return txs;
}

function withdrawTransactions(
  snapshot: PositionSnapshot,
  owner: Address,
): PlannedTx[] {
  if (snapshot.liquidity <= 0n) throw new Error("position is already closed");
  const manager = managerFor(snapshot);
  const txs: PlannedTx[] = snapshot.venue === "aerodrome-slipstream"
    ? [
        decreaseSlipstreamTx({
          positionManager: manager,
          tokenId: snapshot.ref.tokenId,
          liquidity: snapshot.liquidity,
          amount0Min: (snapshot.amount0 * SETTLEMENT_SAFETY_BPS) / BPS,
          amount1Min: (snapshot.amount1 * SETTLEMENT_SAFETY_BPS) / BPS,
          deadlineSec: WALLET_PLAN_DEADLINE_SEC,
        }),
        collectSlipstreamTx(manager, snapshot.ref.tokenId, owner),
      ]
    : [decreaseCalldata(snapshot, 100, owner, MINT_SLIPPAGE_BPS, WALLET_PLAN_DEADLINE_SEC, true)];
  if (snapshot.venue === "aerodrome-slipstream") txs.push(burnSlipstreamTx(manager, snapshot.ref.tokenId));
  return txs;
}

function managerFor(snapshot: PositionSnapshot, chain?: ChainSlug): Address {
  if (snapshot.venue === "aerodrome-slipstream") {
    if (!snapshot.positionManager) throw new Error("Aerodrome position manager is missing");
    return snapshot.positionManager;
  }
  const slug = chain ?? (snapshot.ref.chainId === 4663 ? "robinhood" : "base");
  if (snapshot.ref.protocol === "V4") return addressesFor(slug).v4PositionManager;
  return addressesFor(slug).nfpm;
}

function serialize(tx: PlannedTx): SerializableTx {
  return { ...tx, value: tx.value.toString() };
}

function deserialize(tx: SerializableTx): PlannedTx {
  return { ...tx, value: BigInt(tx.value) };
}

function uniqueAddresses(addresses: readonly Address[]): Address[] {
  const unique = new Map<string, Address>();
  for (const address of addresses) unique.set(address.toLowerCase(), getAddress(address));
  return [...unique.values()];
}

function assertAllowed(transactions: readonly PlannedTx[], allowedTargets: readonly Address[]): void {
  const allowed = new Set(allowedTargets.map((address) => address.toLowerCase()));
  for (const transaction of transactions) {
    if (!allowed.has(transaction.to.toLowerCase())) throw new Error(`Refuse unapproved transaction target ${transaction.to}`);
    if (transaction.data === "0x" && transaction.value === 0n) throw new Error(`Refuse empty transaction to ${transaction.to}`);
  }
}
