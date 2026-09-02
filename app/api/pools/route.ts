import { NextResponse } from "next/server";
import { catalogFallbackSnapshot, fetchCuratedPools, mergePoolSnapshots } from "../../lib/portfolio-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Snapshot = Awaited<ReturnType<typeof fetchCuratedPools>>;

// GeckoTerminal allows roughly thirty requests a minute, so each instance
// sweeps at most once per window and serves the last snapshot meanwhile.
// A degraded sweep keeps the previous good pools and retries sooner.
const FRESH_MS = 10 * 60_000;
const DEGRADED_MS = 2 * 60_000;
let snapshot: Snapshot | undefined;
let expiresAt = 0;
let inflight: Promise<Snapshot> | null = null;

async function refresh(): Promise<Snapshot> {
  if (!inflight) {
    inflight = fetchCuratedPools()
      .then((next) => {
        snapshot = mergePoolSnapshots(snapshot, next);
        expiresAt = Date.now() + (snapshot.degraded.length ? DEGRADED_MS : FRESH_MS);
        return snapshot;
      })
      .catch((error) => {
        // Every upstream failed. Reviewed markets still make a usable menu.
        console.error("[wizzy-pools-refresh]", error instanceof Error ? error.message : "unknown");
        snapshot = snapshot ?? catalogFallbackSnapshot();
        expiresAt = Date.now() + DEGRADED_MS;
        return snapshot;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export async function GET() {
  try {
    if (snapshot && Date.now() < expiresAt) return respond(snapshot);
    if (snapshot) {
      // Stale but present: answer now, refresh in the background.
      void refresh().catch((error) => console.error("[wizzy-pools-refresh]", error instanceof Error ? error.message : "unknown"));
      return respond(snapshot);
    }
    // Cold instance: start the sweep and tell the client to come back rather than blocking on it.
    void refresh().catch((error) => console.error("[wizzy-pools-refresh]", error instanceof Error ? error.message : "unknown"));
    const settled = await Promise.race([inflight, new Promise<null>((resolve) => setTimeout(() => resolve(null), 4_000))]);
    if (settled) return respond(settled);
    return NextResponse.json({ pools: [], asOf: "", scanned: 0, excluded: 0, degraded: [], warming: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[wizzy-pools-error]", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Pool discovery is temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

function respond(payload: Snapshot) {
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=120, stale-while-revalidate=600" },
  });
}
