import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, ApiRequestError, readApiJson } from "../../lib/api-request-server";
import {
  ACHIEVEMENT_METADATA_KEY,
  emptyAchievementRecord,
  normalizeAchievementRecord,
  serializeAchievementRecord,
  type AchievementRecord,
} from "../../lib/achievements";
import { createAppPrivyClient } from "../../lib/privy-server";
import { synchronizeOnchainQuests, verifyOnchainQuestAction } from "../../lib/quest-server";
import { evmWalletAddresses } from "../../lib/quest-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const Body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sync") }).strict(),
  z.object({
    type: z.literal("action"),
    action: z.enum(["compound", "rebalance"]),
    chainId: z.literal(4663),
    tokenId: z.string().regex(/^\d+$/).max(80),
    transactionHashes: z.array(Hash).min(1).max(8),
  }).strict(),
]);

export async function GET(request: Request) {
  try {
    const { user } = await authenticatedPrivyUser(request);
    return privateJson({ record: recordFromMetadata(user.customMetadata) });
  } catch (error) {
    return apiErrorResponse(error, "Could not load quests");
  }
}

export async function POST(request: Request) {
  try {
    const { client, userId, user } = await authenticatedPrivyUser(request);
    const body = Body.parse(await readApiJson(request, 4_096));
    const walletAddresses = evmWalletAddresses(user);
    if (!walletAddresses.length) throw new ApiRequestError("Connect an Ethereum wallet to track quests", 400);
    const current = recordFromMetadata(user.customMetadata);
    let result: { record: AchievementRecord; newlyUnlocked: readonly string[] };
    if (body.type === "sync") {
      result = await synchronizeOnchainQuests(current, walletAddresses);
    } else {
      try {
        const verified = await verifyOnchainQuestAction({
          record: current,
          walletAddresses,
          action: body.action,
          tokenId: body.tokenId,
          transactionHashes: body.transactionHashes.map((hash) => hash.toLowerCase() as `0x${string}`),
        });
        const synchronized = await synchronizeOnchainQuests(verified.record, walletAddresses);
        result = {
          record: synchronized.record,
          newlyUnlocked: [...verified.newlyUnlocked, ...synchronized.newlyUnlocked],
        };
      } catch {
        throw new ApiRequestError("That transaction does not prove this quest", 422);
      }
    }
    await client.setCustomMetadata(userId, {
      ...(user.customMetadata ?? {}),
      [ACHIEVEMENT_METADATA_KEY]: serializeAchievementRecord(result.record),
    });
    return privateJson({ record: result.record, newlyUnlocked: result.newlyUnlocked });
  } catch (error) {
    return apiErrorResponse(error, "Could not update quests");
  }
}

async function authenticatedPrivyUser(request: Request) {
  const client = createAppPrivyClient();
  if (!client) throw new ApiRequestError("quests are temporarily unavailable", 503);
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new ApiRequestError("authentication required", 401);
  try {
    const claims = await client.verifyAuthToken(authorization);
    const user = await client.getUser(claims.userId);
    return { client, userId: claims.userId, user };
  } catch {
    throw new ApiRequestError("authentication required", 401);
  }
}

function recordFromMetadata(metadata: Record<string, string | number | boolean> | undefined): AchievementRecord {
  const stored = metadata?.[ACHIEVEMENT_METADATA_KEY];
  if (typeof stored !== "string") return emptyAchievementRecord();
  try {
    return normalizeAchievementRecord(JSON.parse(stored));
  } catch {
    return emptyAchievementRecord();
  }
}

function privateJson(body: unknown) {
  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
