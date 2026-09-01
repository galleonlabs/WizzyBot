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
  // The plan executes as separate wallet-signed transactions, so the position
  // effect and Wizzy's fee can land under different hashes. Require every
  // provided transaction to be the owner's and successful, then judge the
  // combined logs as one action.
  let verified: { transactionHash: Hex; blockNumber: bigint; positionTokenId: string } | null = null;
  try {
    const receipts = await Promise.all(input.transactionHashes.map((hash) => client.getTransactionReceipt({ hash })));
    for (const receipt of receipts) {
      if (receipt.status !== "success") throw new Error("quest transaction reverted");
      if (!input.walletAddresses.some((address) => address.toLowerCase() === receipt.from.toLowerCase())) {
        throw new Error("quest transaction was not sent by this wallet");
      }
    }
    const anchor = receipts.find((receipt) => receipt.logs.some((log) => log.address.toLowerCase() === "0x73991a25c818bf1f1128deaab1492d45638de0d3")) ?? receipts[0]!;
    const action = verifyQuestActionReceipt({
      action: input.action,
      tokenId: input.tokenId,
      walletAddresses: input.walletAddresses,
      receipt: {
        status: "success",
        from: anchor.from,
        transactionHash: anchor.transactionHash,
        logs: receipts.flatMap((receipt) => receipt.logs.map((log) => ({ address: log.address, data: log.data, topics: log.topics }))),
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
    verified = { transactionHash: anchor.transactionHash, blockNumber: anchor.blockNumber, positionTokenId: action.positionTokenId };
  } catch {
    verified = null;
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
