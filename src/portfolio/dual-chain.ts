import { getAddress, isAddress, type Address } from "viem";
import { chainCatalog } from "../markets/catalog.js";
import { quoteBaseToRobinhoodEth, type RelayBridgeQuote } from "../relay/client.js";
import { planAllocation, type AllocationPlan, type SerializableTx } from "./allocation.js";

const BPS = 10_000n;
const ROBINHOOD_GAS_RESERVE_WEI = 100_000_000_000_000n; // 0.0001 ETH

export type DualChainPlan = {
  kind: "allocate-both";
  owner: Address;
  totalAmountWei: string;
  robinhoodShareBps: number;
  expectedConfirmations: 2;
  stages: [
    {
      id: "base-and-fund-robinhood";
      chain: "base";
      chainId: 8453;
      execution: "wallet_sendCalls";
      atomic: true;
      allocation: AllocationPlan;
      bridge: RelayBridgeQuote;
      transactions: SerializableTx[];
    },
    {
      id: "allocate-robinhood";
      chain: "robinhood";
      chainId: 4663;
      execution: "wallet_sendCalls";
      atomic: true;
      waitForRequestId: string;
      allocation: AllocationPlan;
      transactions: SerializableTx[];
    },
  ];
  notices: string[];
};

export async function planDualChainAllocation(input: {
  owner: string;
  totalAmountWei: bigint;
  robinhoodShareBps?: number;
  baseMarketIds?: readonly string[];
  robinhoodMarketIds?: readonly string[];
}): Promise<DualChainPlan> {
  if (!isAddress(input.owner)) throw new Error("owner must be a valid EVM address");
  const owner = getAddress(input.owner);
  const share = input.robinhoodShareBps ?? 5_000;
  if (!Number.isSafeInteger(share) || share < 1_000 || share > 9_000) {
    throw new Error("Robinhood share must be between 10% and 90%");
  }
  const bridgeInput = (input.totalAmountWei * BigInt(share)) / BPS;
  const baseAmount = input.totalAmountWei - bridgeInput;
  const baseMinimum = BigInt(chainCatalog("base").minimumAllocationWei);
  if (baseAmount < baseMinimum) throw new Error("Both-chain funding leaves less than the Base minimum");

  const bridge = await quoteBaseToRobinhoodEth({ owner, amountInWei: bridgeInput });
  const minimumRobinhoodOutput = BigInt(bridge.minimumAmountOutWei);
  const robinhoodAmount = minimumRobinhoodOutput - ROBINHOOD_GAS_RESERVE_WEI;
  const robinhoodMinimum = BigInt(chainCatalog("robinhood").minimumAllocationWei);
  if (robinhoodAmount < robinhoodMinimum) {
    throw new Error("Both-chain funding leaves less than the Robinhood minimum after Relay fees and gas reserve");
  }

  const [baseAllocation, robinhoodAllocation] = await Promise.all([
    planAllocation({ owner, chain: "base", amountWei: baseAmount, marketIds: input.baseMarketIds }),
    planAllocation({ owner, chain: "robinhood", amountWei: robinhoodAmount, marketIds: input.robinhoodMarketIds }),
  ]);
  const stageOneTransactions = [...baseAllocation.transactions, bridge.transaction];

  return {
    kind: "allocate-both",
    owner,
    totalAmountWei: input.totalAmountWei.toString(),
    robinhoodShareBps: share,
    expectedConfirmations: 2,
    stages: [
      {
        id: "base-and-fund-robinhood",
        chain: "base",
        chainId: 8453,
        execution: "wallet_sendCalls",
        atomic: true,
        allocation: baseAllocation,
        bridge,
        transactions: stageOneTransactions,
      },
      {
        id: "allocate-robinhood",
        chain: "robinhood",
        chainId: 4663,
        execution: "wallet_sendCalls",
        atomic: true,
        waitForRequestId: bridge.requestId,
        allocation: robinhoodAllocation,
        transactions: robinhoodAllocation.transactions,
      },
    ],
    notices: [
      "Confirmation 1 atomically funds the Base portfolio and deposits the Robinhood allocation with Relay.",
      "After Relay reports success, confirmation 2 allocates the received ETH on Robinhood Chain.",
      "The Robinhood plan uses Relay's minimum output less a visible gas reserve; any surplus stays in your wallet.",
      "One-confirmation cross-chain execution is intentionally not promised without a verified smart-account and sponsorship agreement.",
    ],
  };
}
