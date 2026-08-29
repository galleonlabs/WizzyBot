import { getAddress, isAddress, type Address } from "viem";
import { loadEnv } from "../config/env.js";
import { TREASURY } from "../constants.js";
import { bpsOf } from "../core/fees.js";
import { getMarketCatalog } from "../markets/catalog.js";
import { activeSolanaMarkets, getSolanaMarketCatalog } from "../markets/solana-catalog.js";
import { quoteBaseToRobinhoodEth, quoteBaseToSolanaSol, type RelayBridgeQuote, type RelaySolanaQuote } from "../relay/client.js";
import { nativeTransferTx } from "../uniswap/calldata.js";
import { planAllocation, weightedBudgets, type AllocationPlan, type SerializableTx } from "./allocation.js";

const BPS = 10_000n;
const BASE_SHARE_BPS = 6_000n;
const ROBINHOOD_SHARE_BPS = 1_500n;
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

/**
 * Builds the one public Una product: a fixed, versioned meme-liquidity index.
 * Chain and constituent weights are deliberately not user inputs.
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

  const baseGross = (input.totalAmountWei * BASE_SHARE_BPS) / BPS;
  const robinhoodGross = (input.totalAmountWei * ROBINHOOD_SHARE_BPS) / BPS;
  const solanaGross = input.totalAmountWei - baseGross - robinhoodGross;
  const serviceFeeBps = getMarketCatalog().fees.allocateBps;
  const solanaServiceFee = bpsOf(solanaGross, serviceFeeBps);
  const solanaBridgeInput = solanaGross - solanaServiceFee;
  if (solanaBridgeInput <= 0n) throw new Error("amount is too small after fees");

  const [baseAllocation, robinhoodBridge, solanaBridge] = await Promise.all([
    planAllocation({ owner, chain: "base", amountWei: baseGross }),
    quoteBaseToRobinhoodEth({ owner, amountInWei: robinhoodGross }),
    quoteBaseToSolanaSol({ owner, recipient: input.solanaOwner, amountInWei: solanaBridgeInput }),
  ]);

  const robinhoodAmount = BigInt(robinhoodBridge.minimumAmountOutWei) - ROBINHOOD_GAS_RESERVE_WEI;
  if (robinhoodAmount <= 0n) throw new Error("Relay's Robinhood quote leaves no allocatable ETH after gas reserve");
  const robinhoodAllocation = await planAllocation({ owner, chain: "robinhood", amountWei: robinhoodAmount });

  const solanaCatalog = getSolanaMarketCatalog();
  const solanaAmount = BigInt(solanaBridge.minimumAmountOutLamports) - BigInt(solanaCatalog.gasReserveLamports);
  if (solanaAmount < BigInt(solanaCatalog.minimumAllocationLamports)) {
    throw new Error("Increase the amount so Solana receives enough SOL for liquidity and account rent");
  }
  const solanaMarkets = activeSolanaMarkets();
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
    constituentCount: getMarketCatalog().chains.flatMap((chain) => chain.markets).filter((market) => market.status === "active").length + solanaMarkets.length,
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
      "Una chooses the versioned chain split, pools, and liquidity ranges; there are no user allocation controls.",
      "The Base batch funds every network in one intent. Privy then asks for the destination-wallet signatures each network requires.",
      "Every EVM LP NFT and Solana DLMM position is created in wallets controlled by this Privy identity.",
      "Fees are variable and losses are possible. Observed fee pace is not a return promise.",
    ],
  };
}
