import { getAddress, isAddress, type Address } from "viem";
import { loadEnv } from "../config/env.js";
import { TREASURY } from "../constants.js";
import { bpsOf } from "../core/fees.js";
import { getMarketCatalog } from "../markets/catalog.js";
import { activeSolanaMarkets, getSolanaMarketCatalog } from "../markets/solana-catalog.js";
import { quoteBaseToRobinhoodEth, quoteBaseToSolanaSol, quoteEthToRobinhood, type RelayBridgeQuote, type RelaySolanaQuote } from "../relay/client.js";
import { ethFundingChain } from "../relay/origins.js";
import { nativeTransferTx } from "../uniswap/calldata.js";
import { planAllocation, weightedBudgets, type AllocationPlan, type SerializableTx } from "./allocation.js";
import { INDEX_CHAIN_SHARES_BPS, selectMemeIndexMarkets, selectRobinhoodIndexMarkets } from "./index-selection.js";
import { getRobinhoodIndexState } from "../index/registry.js";

const BPS = 10_000n;
const BASE_SHARE_BPS = BigInt(INDEX_CHAIN_SHARES_BPS.base);
const ROBINHOOD_SHARE_BPS = BigInt(INDEX_CHAIN_SHARES_BPS.robinhood);
const SOLANA_SHARE_BPS = BPS - BASE_SHARE_BPS - ROBINHOOD_SHARE_BPS;
const ROBINHOOD_GAS_RESERVE_WEI = 100_000_000_000_000n;

export type SolanaMarketBudget = {
  marketId: string;
  symbol: string;
  pool: string;
  weightBps: number;
  amountLamports: string;
  rangeDelta: number;
};

export type MemeIndexPlan = {
  kind: "meme-index";
  owner: Address;
  solanaOwner: string;
  totalAmountWei: string;
  indexVersion: number;
  constituentCount: number;
  expectedWalletSteps: 3;
  createdAt: string;
  expiresAt: string;
  stages: [
    {
      id: "fund-index";
      chain: "base";
      chainId: 8453;
      allocation: AllocationPlan;
      robinhoodBridge: RelayBridgeQuote;
      solanaBridge: RelaySolanaQuote;
      solanaServiceFeeWei: string;
      transactions: SerializableTx[];
    },
    {
      id: "make-robinhood-markets";
      chain: "robinhood";
      chainId: 4663;
      waitForRequestId: string;
      allocation: AllocationPlan;
      transactions: SerializableTx[];
    },
    {
      id: "make-solana-markets";
      chain: "solana";
      chainId: 792703809;
      waitForRequestId: string;
      amountLamports: string;
      markets: SolanaMarketBudget[];
    },
  ];
  notices: string[];
};

export type RobinhoodIndexPlan = {
  kind: "robinhood-index";
  owner: Address;
  totalAmountWei: string;
  indexVersion: number;
  constituentCount: number;
  sourceChainId: number;
  sourceChainLabel: string;
  expectedWalletSteps: 1 | 2;
  createdAt: string;
  expiresAt: string;
  stages: [
    {
      id: "fund-robinhood";
      chain: "source";
      chainId: number;
      chainLabel: string;
      bridge: RelayBridgeQuote;
      transactions: SerializableTx[];
    },
    {
      id: "make-robinhood-markets";
      chain: "robinhood";
      chainId: 4663;
      waitForRequestId?: string;
      allocation: AllocationPlan;
      transactions: SerializableTx[];
    },
  ] | [
    {
      id: "make-robinhood-markets";
      chain: "robinhood";
      chainId: 4663;
      allocation: AllocationPlan;
      transactions: SerializableTx[];
    },
  ];
  notices: string[];
};

/**
 * Public launch plan: fund Robinhood Chain from the user's chosen ETH network,
 * then open every market their deposit supports in the destination wallet.
 */
export async function planRobinhoodIndex(input: {
  owner: string;
  totalAmountWei: bigint;
  originChainId?: number;
}): Promise<RobinhoodIndexPlan> {
  if (!isAddress(input.owner)) throw new Error("owner must be a valid EVM address");
  if (input.totalAmountWei <= 0n) throw new Error("amount must be positive");
  const owner = getAddress(input.owner);
  const source = ethFundingChain(input.originChainId ?? 4663);
  const indexState = await getRobinhoodIndexState();
  const selection = selectRobinhoodIndexMarkets(input.totalAmountWei, indexState.markets);
  const selectedIds = new Set(selection.marketIds);
  const selectedMarkets = indexState.markets.filter((market) => selectedIds.has(market.id));
  const bridge = source.id === 4663
    ? null
    : await quoteEthToRobinhood({ owner, amountInWei: input.totalAmountWei, originChainId: source.id });
  const received = bridge ? BigInt(bridge.minimumAmountOutWei) : input.totalAmountWei;
  const allocatable = received - ROBINHOOD_GAS_RESERVE_WEI;
  if (allocatable <= 0n) throw new Error("The deposit leaves no ETH for markets after the network reserve");
  const allocation = await planAllocation({
    owner,
    chain: "robinhood",
    amountWei: allocatable,
    markets: selectedMarkets,
  });
  const now = new Date();
  const expiresAt = bridge
    ? Math.min(Date.parse(bridge.expiresAt), Date.parse(allocation.expiresAt))
    : Date.parse(allocation.expiresAt);
  const allocationStage = {
    id: "make-robinhood-markets" as const,
    chain: "robinhood" as const,
    chainId: 4663 as const,
    ...(bridge ? { waitForRequestId: bridge.requestId } : {}),
    allocation,
    transactions: allocation.transactions,
  };

  return {
    kind: "robinhood-index",
    owner,
    totalAmountWei: input.totalAmountWei.toString(),
    indexVersion: indexState.registry?.version ?? getMarketCatalog().version,
    constituentCount: selection.constituentCount,
    sourceChainId: source.id,
    sourceChainLabel: source.label,
    expectedWalletSteps: bridge ? 2 : 1,
    createdAt: now.toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    stages: bridge ? [
      {
        id: "fund-robinhood",
        chain: "source",
        chainId: source.id,
        chainLabel: source.label,
        bridge,
        transactions: [bridge.transaction],
      },
      allocationStage,
    ] : [allocationStage],
    notices: [
      bridge
        ? `Wizzy moves ETH from ${source.label} to Robinhood Chain, then creates every market position your deposit supports.`
        : "Wizzy creates every market position your deposit supports directly on Robinhood Chain.",
      `${bridge ? "Two wallet approvals" : "One wallet approval"}. Every position remains self-custodial.`,
      "Fee APR changes with trading activity. Meme prices can fall, and trading fees may not cover losses.",
    ],
  };
}

/**
 * Builds the one public Wizzy product: a ranked, versioned meme-liquidity index.
 * Deposit size controls breadth; chain, market, and range choices are not inputs.
 */
export async function planMemeIndex(input: {
  owner: string;
  solanaOwner: string;
  totalAmountWei: bigint;
}): Promise<MemeIndexPlan> {
  if (!isAddress(input.owner)) throw new Error("owner must be a valid EVM address");
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.solanaOwner)) throw new Error("solanaOwner must be a valid Solana address");
  if (input.totalAmountWei <= 0n) throw new Error("amount must be positive");
  const owner = getAddress(input.owner);
  const selection = selectMemeIndexMarkets(input.totalAmountWei);

  const baseGross = (input.totalAmountWei * BASE_SHARE_BPS) / BPS;
  const robinhoodGross = (input.totalAmountWei * ROBINHOOD_SHARE_BPS) / BPS;
  const solanaGross = input.totalAmountWei - baseGross - robinhoodGross;
  const serviceFeeBps = getMarketCatalog().fees.allocateBps;
  const solanaServiceFee = bpsOf(solanaGross, serviceFeeBps);
  const solanaBridgeInput = solanaGross - solanaServiceFee;
  if (solanaBridgeInput <= 0n) throw new Error("amount is too small after fees");

  const [baseAllocation, robinhoodBridge, solanaBridge] = await Promise.all([
    planAllocation({ owner, chain: "base", amountWei: baseGross, marketIds: selection.marketIds.base }),
    quoteBaseToRobinhoodEth({ owner, amountInWei: robinhoodGross }),
    quoteBaseToSolanaSol({ owner, recipient: input.solanaOwner, amountInWei: solanaBridgeInput }),
  ]);

  const robinhoodAmount = BigInt(robinhoodBridge.minimumAmountOutWei) - ROBINHOOD_GAS_RESERVE_WEI;
  if (robinhoodAmount <= 0n) throw new Error("Relay's Robinhood quote leaves no allocatable ETH after gas reserve");
  const robinhoodAllocation = await planAllocation({ owner, chain: "robinhood", amountWei: robinhoodAmount, marketIds: selection.marketIds.robinhood });

  const solanaCatalog = getSolanaMarketCatalog();
  const solanaAmount = BigInt(solanaBridge.minimumAmountOutLamports) - BigInt(solanaCatalog.gasReserveLamports);
  if (solanaAmount < BigInt(solanaCatalog.minimumAllocationLamports)) {
    throw new Error("Increase the amount so Solana receives enough SOL for liquidity and account rent");
  }
  const solanaMarkets = activeSolanaMarkets(selection.marketIds.solana);
  const budgets = weightedBudgets(solanaAmount, solanaMarkets.map((market) => market.weightBps));
  const env = loadEnv();
  const solanaFeeTx = nativeTransferTx(env.treasury ?? TREASURY, solanaServiceFee);
  const now = new Date();
  const expiresAt = [baseAllocation.expiresAt, robinhoodBridge.expiresAt, solanaBridge.expiresAt, robinhoodAllocation.expiresAt]
    .map(Date.parse)
    .reduce((earliest, value) => Math.min(earliest, value));

  return {
    kind: "meme-index",
    owner,
    solanaOwner: input.solanaOwner,
    totalAmountWei: input.totalAmountWei.toString(),
    indexVersion: getMarketCatalog().version,
    constituentCount: selection.constituentCount,
    expectedWalletSteps: 3,
    createdAt: now.toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    stages: [
      {
        id: "fund-index",
        chain: "base",
        chainId: 8453,
        allocation: baseAllocation,
        robinhoodBridge,
        solanaBridge,
        solanaServiceFeeWei: solanaServiceFee.toString(),
        transactions: [
          ...baseAllocation.transactions,
          robinhoodBridge.transaction,
          solanaBridge.transaction,
          { ...solanaFeeTx, value: solanaFeeTx.value.toString() },
        ],
      },
      {
        id: "make-robinhood-markets",
        chain: "robinhood",
        chainId: 4663,
        waitForRequestId: robinhoodBridge.requestId,
        allocation: robinhoodAllocation,
        transactions: robinhoodAllocation.transactions,
      },
      {
        id: "make-solana-markets",
        chain: "solana",
        chainId: 792703809,
        waitForRequestId: solanaBridge.requestId,
        amountLamports: solanaAmount.toString(),
        markets: solanaMarkets.map((market, index) => ({
          marketId: market.id,
          symbol: market.symbol,
          pool: market.pool,
          weightBps: market.weightBps,
          amountLamports: budgets[index]!.toString(),
          rangeDelta: market.rangeDelta,
        })),
      },
    ],
    notices: [
      "Wizzy opens as many reviewed markets as your deposit can support, then chooses the networks, pools, and liquidity ranges.",
      "The Base batch funds every network in one intent. Privy then asks for the destination-wallet signatures each network requires.",
      "Every EVM LP NFT and Solana DLMM position is created in wallets controlled by this Privy identity.",
      "Fee APR changes with trading activity. Meme prices can fall, and trading fees may not cover losses.",
    ],
  };
}
