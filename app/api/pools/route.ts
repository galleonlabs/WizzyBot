import { NextResponse } from "next/server";
import { catalogFallbackSnapshot, fetchCuratedPools, mergePoolSnapshots } from "../../lib/portfolio-server";
import { readSnapshot, snapshotStoreConfigured } from "../../lib/pool-snapshot-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Snapshot = Awaited<ReturnType<typeof fetchCuratedPools>>;

// Read path only. The cron at /api/cron/pools is the single writer; this route
// serves its snapshot from the Blob store with a short CDN cache. Without a
// store (local dev) it sweeps once per process instead.
const MEMO_MS = 30_000;
const LOCAL_SWEEP_MS = 10 * 60_000;
let memo: { snapshot: Snapshot; expiresAt: number } | undefined;
let localSweep: Promise<Snapshot> | null = null;

export async function GET() {
  try {
    if (memo && Date.now() < memo.expiresAt) return respond(memo.snapshot);
    if (snapshotStoreConfigured()) {
      const stored = await readSnapshot();
      if (stored) {
        memo = { snapshot: stored as Snapshot, expiresAt: Date.now() + MEMO_MS };
        return respond(stored as Snapshot);
      }
      // First deploy before the cron has run: reviewed markets keep the page useful.
      return NextResponse.json(catalogFallbackSnapshot(), { headers: { "Cache-Control": "no-store" } });
    }
    return respond(await localSnapshot());
  } catch (error) {
    console.error("[wizzy-pools-error]", error instanceof Error ? error.message : "unknown");
    if (memo) return respond(memo.snapshot);
    return NextResponse.json(catalogFallbackSnapshot(), { headers: { "Cache-Control": "no-store" } });
  }
}

async function localSnapshot(): Promise<Snapshot> {
  if (!localSweep) {
    localSweep = fetchCuratedPools()
      .then((next) => {
        const merged = mergePoolSnapshots(memo?.snapshot, next) as Snapshot;
        memo = { snapshot: merged, expiresAt: Date.now() + LOCAL_SWEEP_MS };
        return merged;
      })
      .catch((error) => {
        if (memo) return memo.snapshot;
        throw error;
      })
      .finally(() => {
        localSweep = null;
      });
  }
  return localSweep;
}

function respond(payload: Snapshot) {
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" },
  });
}
