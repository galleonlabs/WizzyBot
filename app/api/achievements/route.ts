import { NextResponse } from "next/server";
import { apiErrorResponse, ApiRequestError, readApiJson } from "../../lib/api-request-server";
import {
  ACHIEVEMENT_METADATA_KEY,
  emptyAchievementRecord,
  mergeAchievementRecords,
  normalizeAchievementRecord,
  type AchievementRecord,
} from "../../lib/achievements";
import { createAppPrivyClient } from "../../lib/privy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { client, userId } = await authenticatedPrivyUser(request);
    const user = await client.getUser(userId);
    return privateJson({ record: recordFromMetadata(user.customMetadata) });
  } catch (error) {
    return apiErrorResponse(error, "Could not load achievements");
  }
}

export async function POST(request: Request) {
  try {
    const { client, userId } = await authenticatedPrivyUser(request);
    const body = await readApiJson(request, 8_192);
    if (!body || typeof body !== "object" || Array.isArray(body) || !("record" in body)) {
      throw new ApiRequestError("achievement record required", 400);
    }
    const incoming = normalizeAchievementRecord((body as { record: unknown }).record);
    const user = await client.getUser(userId);
    const current = recordFromMetadata(user.customMetadata);
    const record = mergeAchievementRecords(current, incoming);
    await client.setCustomMetadata(userId, {
      ...(user.customMetadata ?? {}),
      [ACHIEVEMENT_METADATA_KEY]: JSON.stringify(record),
    });
    return privateJson({ record });
  } catch (error) {
    return apiErrorResponse(error, "Could not save achievements");
  }
}

async function authenticatedPrivyUser(request: Request) {
  const client = createAppPrivyClient();
  if (!client) throw new ApiRequestError("achievements are temporarily unavailable", 503);
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new ApiRequestError("authentication required", 401);
  try {
    const claims = await client.verifyAuthToken(authorization);
    return { client, userId: claims.userId };
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
