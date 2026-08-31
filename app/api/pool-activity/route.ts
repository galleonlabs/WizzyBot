import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { fetchRecentPoolActivity, mergePoolActivityItems } from "../../lib/portfolio-server";
import type { PoolActivityPayload } from "../../lib/portfolio-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Survives across requests on a reused instance so narrow fallback scans
// accumulate a full rail and a failed refresh serves recent real events
// instead of an empty "unavailable" strip.
let lastGood: PoolActivityPayload | null = null;

const getPoolActivity = unstable_cache(async (): Promise<PoolActivityPayload> => {
  try {
    const activity = await fetchRecentPoolActivity();
    const items = mergePoolActivityItems(lastGood?.items ?? [], activity.items);
    lastGood = { state: "ready", ...activity, items };
    return lastGood;
  } catch (error) {
    console.error("[pool-activity] refresh failed", rpcErrorChain(error));
    if (lastGood?.items.length) return lastGood;
    return { state: "unavailable", items: [], asOfBlock: null, scannedBlocks: 0, rpcRequests: 2 };
  }
}, ["wizzy-pool-activity-v4"], { revalidate: 60, tags: ["pool-activity"] });

export async function GET() {
  return NextResponse.json(await getPoolActivity(), {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}

function rpcErrorChain(error: unknown) {
  const chain: Array<{ name: string; code?: string | number; status?: number }> = [];
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const value = current as { name?: unknown; code?: unknown; status?: unknown; cause?: unknown };
    chain.push({
      name: typeof value.name === "string" ? value.name : "Error",
      ...(typeof value.code === "string" || typeof value.code === "number" ? { code: value.code } : {}),
      ...(typeof value.status === "number" ? { status: value.status } : {}),
    });
    current = value.cause;
  }
  return chain;
}
