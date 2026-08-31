import "server-only";
import { createPublicClient, http, type Hex } from "viem";
import {
  observeOnchainPortfolio,
  recordVerifiedAchievementAction,
  type AchievementAction,
  type AchievementProof,
  type AchievementRecord,
} from "./achievements";
import { robinhoodChain, ROBINHOOD_RPC_DEFAULT } from "./chains";
import { fetchPositionList, fetchPositionStatus } from "./hosted-server";
import { getMarketCatalog } from "./portfolio-server";
import { deriveQuestObservation, verifyQuestActionReceipt } from "./quest-verification";

export async function synchronizeOnchainQuests(
  record: AchievementRecord,
  walletAddresses: readonly `0x${string}`[],
): Promise<{ record: AchievementRecord; newlyUnlocked: string[] }> {
  const catalog = getMarketCatalog() as { chains?: Array<{ slug?: string; markets?: Array<{ pool?: string; status?: string }> }> };
  const robinhood = catalog.chains?.find((chain) => chain.slug === "robinhood");
  const activePools = new Set((robinhood?.markets ?? [])
    .filter((market) => market.status === "active" && typeof market.pool === "string")
    .map((market) => market.pool!.toLowerCase()));
  const payloads = await Promise.all(walletAddresses.map((address) => fetchPositionList(address, "robinhood")));
  const observed = deriveQuestObservation(payloads, activePools);
  return observeOnchainPortfolio(record, observed);
}

export async function verifyOnchainQuestAction(input: {
  record: AchievementRecord;
  walletAddresses: readonly `0x${string}`[];
  action: AchievementAction;
  tokenId: string;
  transactionHashes: readonly Hex[];
}): Promise<{ record: AchievementRecord; newlyUnlocked: string[]; proof: AchievementProof }> {
  const client = createPublicClient({
    chain: robinhoodChain,
    transport: http(process.env.ROBINHOOD_RPC_URL?.trim() || ROBINHOOD_RPC_DEFAULT),
  });
  let verified: { transactionHash: Hex; blockNumber: bigint; positionTokenId: string } | null = null;
  for (const transactionHash of input.transactionHashes) {
    try {
      const receipt = await client.getTransactionReceipt({ hash: transactionHash });
      const action = verifyQuestActionReceipt({
        action: input.action,
        tokenId: input.tokenId,
        walletAddresses: input.walletAddresses,
        receipt: {
          status: receipt.status,
          from: receipt.from,
          transactionHash: receipt.transactionHash,
          logs: receipt.logs.map((log) => ({ address: log.address, data: log.data, topics: log.topics })),
        },
      });
      const status = await fetchPositionStatus(action.positionTokenId, "robinhood") as Record<string, unknown>;
      const view = status.view && typeof status.view === "object" ? status.view as Record<string, unknown> : {};
      const pool = typeof view.pool === "string" ? view.pool.toLowerCase() : "";
      const catalog = getMarketCatalog() as { chains?: Array<{ slug?: string; markets?: Array<{ pool?: string; status?: string }> }> };
      const activePools = new Set(catalog.chains?.find((chain) => chain.slug === "robinhood")?.markets
        ?.filter((market) => market.status === "active" && typeof market.pool === "string")
        .map((market) => market.pool!.toLowerCase()) ?? []);
      if (!activePools.has(pool)) throw new Error("quest position is not in the curated Robinhood index");
      verified = { transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber, positionTokenId: action.positionTokenId };
      break;
    } catch {
      // A wallet batch can expose multiple receipt hashes. Only one must carry
      // the atomic position-manager effects for this claimed action.
    }
  }
  if (!verified) throw new Error("No confirmed transaction proves this quest action");
  const block = await client.getBlock({ blockNumber: verified.blockNumber });
  const proof: AchievementProof = {
    action: input.action,
    chainId: 4663,
    tokenId: input.tokenId,
    transactionHash: verified.transactionHash,
    verifiedAt: new Date(Number(block.timestamp) * 1_000).toISOString(),
  };
  return { ...recordVerifiedAchievementAction(input.record, proof), proof };
}
