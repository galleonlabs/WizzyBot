import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { fetchRecentPoolActivity } from "../../lib/portfolio-server";
import type { PoolActivityPayload } from "../../lib/portfolio-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getPoolActivity = unstable_cache(async (): Promise<PoolActivityPayload> => {
  try {
    const activity = await fetchRecentPoolActivity();
    return { state: "ready", ...activity };
  } catch (error) {
    console.error("[pool-activity] refresh failed", rpcErrorChain(error));
    return { state: "unavailable", items: [], asOfBlock: null, scannedBlocks: 0, rpcRequests: 2 };
  }
}, ["wizzy-pool-activity-v2"], { revalidate: 60, tags: ["pool-activity"] });

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
