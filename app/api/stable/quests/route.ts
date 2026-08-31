import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, ApiRequestError, readApiJson } from "../../../lib/api-request-server";
import { createAppPrivyClient } from "../../../lib/privy-server";
import { evmWalletAddresses } from "../../../lib/quest-verification";
import { readStablePositions } from "../../../lib/portfolio-server";
import {
  emptyYieldQuestRecord,
  normalizeYieldQuestRecord,
  observeYieldPortfolio,
  serializeYieldQuestRecord,
  YIELD_QUEST_METADATA_KEY,
  type YieldQuestRecord,
} from "../../../lib/yield-quests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ type: z.literal("sync") }).strict();

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
    Body.parse(await readApiJson(request, 1_024));
    const walletAddresses = evmWalletAddresses(user);
    if (!walletAddresses.length) throw new ApiRequestError("Connect an Ethereum wallet to track quests", 400);
    const current = recordFromMetadata(user.customMetadata);
    const observed = await observeWallets(walletAddresses);
    const result = observeYieldPortfolio(current, observed);
    await client.setCustomMetadata(userId, {
      ...(user.customMetadata ?? {}),
      [YIELD_QUEST_METADATA_KEY]: serializeYieldQuestRecord(result.record),
    });
    return privateJson({ record: result.record, newlyUnlocked: result.newlyUnlocked });
  } catch (error) {
    return apiErrorResponse(error, "Could not update quests");
  }
}

async function observeWallets(walletAddresses: readonly `0x${string}`[]): Promise<{ venueCount: number; stackUsd: number }> {
  const held = new Set<string>();
  let stackUnits = 0n;
  for (const owner of walletAddresses) {
    const rows = await readStablePositions({ owner }) as Array<{ vaultId?: string; assetsUnits?: string }>;
    for (const row of rows) {
      if (typeof row.vaultId === "string") held.add(row.vaultId);
      if (typeof row.assetsUnits === "string" && /^\d+$/.test(row.assetsUnits)) stackUnits += BigInt(row.assetsUnits);
    }
  }
  return { venueCount: held.size, stackUsd: Number(stackUnits) / 1e6 };
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

function recordFromMetadata(metadata: Record<string, string | number | boolean> | undefined): YieldQuestRecord {
  const stored = metadata?.[YIELD_QUEST_METADATA_KEY];
  if (typeof stored !== "string") return emptyYieldQuestRecord();
  try {
    return normalizeYieldQuestRecord(JSON.parse(stored));
  } catch {
    return emptyYieldQuestRecord();
  }
}

function privateJson(body: unknown) {
  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
