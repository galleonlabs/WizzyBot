import { getAddress, isAddress, type Address, type PublicClient } from "viem";
import { addressesFor, chainOf, type ChainSlug } from "../chains.js";
import { adapterFor } from "../core/protocols.js";
import { AerodromeSlipstreamAdapter } from "../aerodrome/positions.js";
import { aerodromeDeployment } from "../aerodrome/deployments.js";
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
import { recenterRangeForPreset, type RangePreset } from "../core/ticks.js";
import { chainCatalog, type CuratedMarket } from "../markets/catalog.js";
import { makePublicClient } from "../signer/broadcast.js";
import type { PlannedTx, PositionSnapshot, Protocol } from "../types.js";
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
import { permit2ApproveTx, poolKeyFromPosition, v4BurnTx, v4ClaimFeesTx, v4Currency, v4IncreaseTx, v4MintTx } from "../uniswap/v4-calldata.js";
import { quoterV2Abi } from "../chain/abi.js";
import { fittedLiquidityAmounts, liquidityForAmounts } from "../core/hydrate.js";
import { planAllocation, type AllocationPlan, type SerializableTx } from "./allocation.js";
import { WALLET_PLAN_DEADLINE_SEC } from "../constants.js";

const PLAN_TTL_MS = 8 * 60_000;
const WITHDRAW_FEE_SAFETY_BPS = 9_800n;
const BPS = 10_000n;
const WITHDRAW_SWAP_SLIPPAGE_BPS = 150n;

export type PositionActionPlan = {
  kind: "collect" | "compound" | "increase" | "rebalance" | "withdraw";
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
    preset: RangePreset;
  };
  settlement?: { asset: "ETH"; minimumAmountWei: string; marketSymbol: string };
  transactions: SerializableTx[];
  allowedTargets: Address[];
  createdAt: string;
  expiresAt: string;
  notices: string[];
};

export async function planPositionAction(input: {
  owner: string;
  chain: ChainSlug;
  tokenId: bigint;
  action: "collect" | "compound" | "increase" | "rebalance" | "withdraw";
  amountWei?: bigint;
  protocol?: Protocol;
  venue?: "uniswap-v3" | "aerodrome-slipstream";
  positionManager?: string;
  rangePreset?: RangePreset;
}): Promise<PositionActionPlan> {
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
    const deploymentId = chainCatalog("base").markets
      .filter((market) => market.protocol === "AERODROME_SLIPSTREAM" && market.aerodromeDeployment)
      .map((market) => market.aerodromeDeployment!)
      .find((id) => aerodromeDeployment(id).positionManager.toLowerCase() === input.positionManager!.toLowerCase());
    if (!deploymentId) throw new Error("position manager is not in Wizzy's curated Aerodrome catalog");
    snapshot = await new AerodromeSlipstreamAdapter(client, deploymentId).readPosition(input.tokenId);
  } else {
    const adapter = adapterFor(input.protocol ?? "V3", client);
    adapter.bindOwner?.(owner);
    snapshot = await adapter.readPosition(input.tokenId);
  }
  if (snapshot.owner.toLowerCase() !== owner.toLowerCase()) throw new Error("wallet does not own this position");
  const configuredMarkets = chainCatalog(input.chain).markets;
  const configured = configuredMarkets.find((market) => positionPoolIsConfigured(snapshot, [market]));
  if (!configured) throw new Error("position pool is not in Wizzy's curated market catalog");
  if (input.action === "increase") {
    if (!input.amountWei || input.amountWei <= 0n) throw new Error("Enter an ETH amount to add");
    const allocation = await planAllocation({
      owner,
      chain: input.chain,
      amountWei: input.amountWei,
      marketId: configured.id,
      protocol: snapshot.ref.protocol === "V2" || snapshot.ref.protocol === "V4" ? snapshot.ref.protocol : undefined,
      client,
    });
    return buildIncreasePositionActionPlan(snapshot, allocation);
  }
  if (input.action === "rebalance") {
    if (snapshot.ref.protocol === "V2") throw new Error("Uniswap V2 positions are already full range");
    const available0 = ((snapshot.amount0 + snapshot.uncollected0) * WITHDRAW_FEE_SAFETY_BPS) / BPS;
    const available1 = ((snapshot.amount1 + snapshot.uncollected1) * WITHDRAW_FEE_SAFETY_BPS) / BPS;
    let swap: RebalanceSwap | undefined;
    if (snapshot.amount0 === 0n && available1 > 1n) {
      swap = await quoteRebalanceSwap(client, input.chain, configured, snapshot.token1.address, snapshot.token0.address, available1 / 2n);
    } else if (snapshot.amount1 === 0n && available0 > 1n) {
      swap = await quoteRebalanceSwap(client, input.chain, configured, snapshot.token0.address, snapshot.token1.address, available0 / 2n);
    }
    return buildRebalancePositionActionPlan(snapshot, owner, input.chain, swap, input.rangePreset);
  }
  const plan = buildPositionActionPlan(snapshot, owner, input.chain, input.action);
  if (input.action !== "withdraw" || input.chain !== "robinhood" || configured.protocol !== "V3") return plan;
  return addRobinhoodEthSettlement(plan, snapshot, configured, client);
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
    ? v2AddFromPosition(snapshot, add0, add1, allocation.owner, 150)
    : snapshot.ref.protocol === "V4"
      ? v4IncreaseTx(snapshot, fitted!.liquidity, fitted!.amount0, fitted!.amount1, 150)
      : snapshot.venue === "aerodrome-slipstream"
        ? increaseSlipstreamTx({
            positionManager: manager,
            tokenId: snapshot.ref.tokenId,
            amount0: fitted!.amount0,
            amount1: fitted!.amount1,
            slippageBps: 150,
            deadlineSec: WALLET_PLAN_DEADLINE_SEC,
          })
        : increaseCalldata(
            snapshot,
            add0,
            add1,
            150,
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

async function addRobinhoodEthSettlement(
  plan: PositionActionPlan,
  snapshot: PositionSnapshot,
  market: CuratedMarket,
  client: PublicClient,
): Promise<PositionActionPlan> {
  const addresses = addressesFor("robinhood");
  if (market.quoteToken.toLowerCase() !== addresses.weth.toLowerCase()) {
    throw new Error("This market cannot currently settle to Robinhood ETH");
  }
  const quoteIsToken0 = snapshot.token0.address.toLowerCase() === market.quoteToken.toLowerCase();
  const quoteGrossFloor = ((quoteIsToken0 ? snapshot.amount0 + snapshot.uncollected0 : snapshot.amount1 + snapshot.uncollected1) * 9_850n) / BPS;
  const memeGrossFloor = ((quoteIsToken0 ? snapshot.amount1 + snapshot.uncollected1 : snapshot.amount0 + snapshot.uncollected0) * 9_850n) / BPS;
  const wethFloor = quoteGrossFloor;
  const memeToSwap = memeGrossFloor;
  if (wethFloor < 0n || memeToSwap < 0n || (wethFloor === 0n && memeToSwap === 0n)) {
    throw new Error("This position is too small to withdraw to ETH");
  }

  const settlementTransactions: PlannedTx[] = [];
  let minimumSwapOut = 0n;
  if (memeToSwap > 0n) {
    const quote = await client.simulateContract({
      address: addresses.quoterV2,
      abi: quoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [{
        tokenIn: market.token,
        tokenOut: market.quoteToken,
        amountIn: memeToSwap,
        fee: market.fee,
        sqrtPriceLimitX96: 0n,
      }],
    });
    minimumSwapOut = (quote.result[0] * (BPS - WITHDRAW_SWAP_SLIPPAGE_BPS)) / BPS;
    if (minimumSwapOut <= 0n) throw new Error("The market returned no usable ETH withdrawal quote");
    settlementTransactions.push(
      erc20ApproveTx(market.token, addresses.swapRouter02, memeToSwap),
      exactInV3Tx({
        tokenIn: market.token,
        tokenOut: market.quoteToken,
        fee: market.fee,
        amountIn: memeToSwap,
        amountOutMin: minimumSwapOut,
        recipient: plan.owner,
        chainId: 4663,
      }),
    );
  }
  const minimumEth = wethFloor + minimumSwapOut;
  settlementTransactions.push(unwrapEthTx(minimumEth, 4663));
  const transactions = [...plan.transactions, ...settlementTransactions.map(serialize)];
  const allowedTargets = uniqueAddresses([...plan.allowedTargets, addresses.swapRouter02, addresses.weth, market.token]);
  assertAllowed(transactions.map(deserialize), allowedTargets);
  return {
    ...plan,
    transactions,
    allowedTargets,
    settlement: { asset: "ETH", minimumAmountWei: minimumEth.toString(), marketSymbol: market.symbol },
    notices: [
      `Your ${market.symbol} position closes and converts to native ETH through wallet-confirmed steps.`,
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
      v2RemoveFromPosition(snapshot, owner, 100, 150),
    ], targets: [router, snapshot.pool] };
  }

  if (snapshot.ref.protocol === "V4") {
    const addresses = addressesFor(chain);
    if (action === "withdraw") {
      return { transactions: [v4BurnTx(snapshot, owner, 150)], targets: [addresses.v4PositionManager] };
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
    transactions.push(v4IncreaseTx(snapshot, liquidity, add0, add1, 150));
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

type RebalanceSwapBase = {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minimumAmountOut: bigint;
};

type RebalanceSwap = RebalanceSwapBase & (
  | { venue: "uniswap-v3"; router: Address; fee: number }
  | { venue: "aerodrome-slipstream"; router: Address; tickSpacing: number }
);

async function quoteRebalanceSwap(
  client: PublicClient,
  chain: ChainSlug,
  market: CuratedMarket,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
): Promise<RebalanceSwap> {
  const addresses = addressesFor(chain);
  if (market.protocol === "AERODROME_SLIPSTREAM") {
    if (chain !== "base" || !market.aerodromeDeployment) throw new Error("This Aerodrome market has no supported rebalance route");
    const deployment = aerodromeDeployment(market.aerodromeDeployment);
    const quote = await client.simulateContract({
      address: deployment.quoter,
      abi: slipstreamQuoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn, tickSpacing: market.tickSpacing, sqrtPriceLimitX96: 0n }],
    });
    const minimumAmountOut = (quote.result[0] * (BPS - WITHDRAW_SWAP_SLIPPAGE_BPS)) / BPS;
    if (minimumAmountOut <= 0n) throw new Error("The pool returned no usable rebalance quote");
    return {
      venue: "aerodrome-slipstream",
      router: deployment.swapRouter,
      tokenIn,
      tokenOut,
      amountIn,
      minimumAmountOut,
      tickSpacing: market.tickSpacing,
    };
  }
  const quote = await client.simulateContract({
    address: addresses.quoterV2,
    abi: quoterV2Abi,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn, fee: market.fee, sqrtPriceLimitX96: 0n }],
  });
  const minimumAmountOut = (quote.result[0] * (BPS - WITHDRAW_SWAP_SLIPPAGE_BPS)) / BPS;
  if (minimumAmountOut <= 0n) throw new Error("The pool returned no usable rebalance quote");
  return {
    venue: "uniswap-v3",
    router: addresses.swapRouter02,
    tokenIn,
    tokenOut,
    amountIn,
    minimumAmountOut,
    fee: market.fee,
  };
}

export function buildRebalancePositionActionPlan(
  snapshot: PositionSnapshot,
  owner: Address,
  chain: ChainSlug,
  swap?: RebalanceSwap,
  rangePreset: RangePreset = "balanced",
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
  const targetRange = recenterRangeForPreset(
    snapshot.tickLower,
    snapshot.tickUpper,
    snapshot.tickCurrent,
    snapshot.tickSpacing,
    rangePreset,
  );
  const range = {
    ...targetRange,
    currentTick: snapshot.tickCurrent,
    previousTickLower: snapshot.tickLower,
    previousTickUpper: snapshot.tickUpper,
    preset: rangePreset,
  };
  const positionManager = managerFor(snapshot, chain);
  const addresses = addressesFor(chain);
  const aerodrome = snapshot.venue === "aerodrome-slipstream";
  const transactions: PlannedTx[] = snapshot.ref.protocol === "V4"
    ? [v4BurnTx(snapshot, owner, 150)]
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
    : [decreaseCalldata(snapshot, 100, owner, 150, WALLET_PLAN_DEADLINE_SEC, true)];
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
    const liquidity = liquidityForAmounts(snapshot, add0, add1, range.tickLower, range.tickUpper);
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
      slippageBps: 150,
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
      slippageBps: 150,
      deadlineSec: WALLET_PLAN_DEADLINE_SEC,
    }));
  } else {
    if (add0 > 0n) transactions.push(erc20ApproveTx(snapshot.token0.address, positionManager, add0));
    if (add1 > 0n) transactions.push(erc20ApproveTx(snapshot.token1.address, positionManager, add1));
    transactions.push(mintCalldata({
      position: snapshot,
      tickLower: range.tickLower,
      tickUpper: range.tickUpper,
      amount0: add0,
      amount1: add1,
      recipient: owner,
      slippageBps: 150,
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
      `Your current ${aerodrome ? "Aerodrome Slipstream" : snapshot.ref.protocol} position closes and a new ${rangePreset} range opens around the live price through wallet-confirmed steps.`,
      "Every completed step settles to your wallet. If a later step fails, Wizzy never holds the recovered pool assets.",
      "Wizzy swaps only when an out-of-range position cannot fund the new range. Any amount that does not fit remains in your wallet.",
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
        slippageBps: 150,
        deadlineSec: WALLET_PLAN_DEADLINE_SEC,
      })
    : increaseCalldata(snapshot, add0, add1, 150, WALLET_PLAN_DEADLINE_SEC));
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
          amount0Min: (snapshot.amount0 * 9_850n) / BPS,
          amount1Min: (snapshot.amount1 * 9_850n) / BPS,
          deadlineSec: WALLET_PLAN_DEADLINE_SEC,
        }),
        collectSlipstreamTx(manager, snapshot.ref.tokenId, owner),
      ]
    : [decreaseCalldata(snapshot, 100, owner, 150, WALLET_PLAN_DEADLINE_SEC, true)];
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
