import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { fetchRecentPoolActivity } from "../../lib/portfolio-server";
import type { PoolActivityPayload } from "../../lib/portfolio-types";

export const runtime = "nodejs";
export const revalidate = 60;

const getPoolActivity = unstable_cache(async (): Promise<PoolActivityPayload> => {
  try {
    const activity = await fetchRecentPoolActivity();
    return { state: "ready", ...activity };
  } catch {
    return { state: "unavailable", items: [], asOfBlock: null, scannedBlocks: 0, rpcRequests: 2 };
  }
}, ["wizzy-pool-activity-v1"], { revalidate: 60, tags: ["pool-activity"] });

export async function GET() {
  return NextResponse.json(await getPoolActivity(), {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}
