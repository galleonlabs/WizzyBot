import { NextResponse } from "next/server";
import { z } from "zod";
import { getAddress, isAddress } from "viem";
import { apiErrorResponse, ApiRequestError, readApiJson } from "../../lib/api-request-server";
import { normalizeAchievementRecord, type AchievementRecord } from "../../lib/achievements";
import { synchronizeOnchainQuests, verifyOnchainQuestAction } from "../../lib/quest-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const Owner = z.string().refine((value) => isAddress(value), "owner must be an Ethereum address");
const Body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sync"), owner: Owner, record: z.unknown() }).strict(),
  z.object({
    type: z.literal("action"),
    owner: Owner,
    record: z.unknown(),
    action: z.enum(["compound", "rebalance"]),
    chainId: z.literal(4663),
    tokenId: z.string().regex(/^\d+$/).max(80),
    transactionHashes: z.array(Hash).min(1).max(8),
  }).strict(),
]);

/**
 * Quests are wallet-native. Progress derives from public onchain state and
 * per-transaction proofs; the browser keeps the record. This endpoint is a
 * stateless verifier — it stores nothing and needs no login, so nothing here
 * can move funds or reveal anything the chain does not already show.
 */
export async function POST(request: Request) {
  try {
    const body = Body.parse(await readApiJson(request, 16_384));
    const owner = getAddress(body.owner);
    const current = normalizeAchievementRecord(body.record);
    let result: { record: AchievementRecord; newlyUnlocked: readonly string[] };
    if (body.type === "sync") {
      result = await synchronizeOnchainQuests(current, [owner]);
    } else {
      try {
        const verified = await verifyOnchainQuestAction({
          record: current,
          walletAddresses: [owner],
          action: body.action,
          tokenId: body.tokenId,
          transactionHashes: body.transactionHashes.map((hash) => hash.toLowerCase() as `0x${string}`),
        });
        const synchronized = await synchronizeOnchainQuests(verified.record, [owner]);
        result = {
          record: synchronized.record,
          newlyUnlocked: [...verified.newlyUnlocked, ...synchronized.newlyUnlocked],
        };
      } catch {
        throw new ApiRequestError("That transaction does not prove this quest", 422);
      }
    }
    return NextResponse.json(
      { record: result.record, newlyUnlocked: result.newlyUnlocked },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error, "Could not update quests");
  }
}
