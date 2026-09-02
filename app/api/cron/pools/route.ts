import { NextResponse } from "next/server";
import { fetchCuratedPools, mergePoolSnapshots } from "../../../lib/portfolio-server";
import { readSnapshot, snapshotStoreConfigured, writeSnapshot } from "../../../lib/pool-snapshot-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The only place that talks to GeckoTerminal and GoPlus. Vercel Cron calls it
 * every five minutes (see vercel.json). A degraded sweep merges into the last
 * good snapshot; a failed sweep leaves it untouched.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!snapshotStoreConfigured()) {
    return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN is not configured" }, { status: 503 });
  }
  const started = Date.now();
  const previous = await readSnapshot().catch(() => null);
  try {
    const next = await fetchCuratedPools();
    const merged = mergePoolSnapshots(previous ?? undefined, next);
    const url = await writeSnapshot(merged as never);
    return NextResponse.json({
      ok: true,
      url,
      pools: merged.pools.length,
      scanned: merged.scanned,
      excluded: merged.excluded,
      degraded: merged.degraded,
      elapsedMs: Date.now() - started,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[wizzy-pools-cron]", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({
      ok: false,
      kept: previous ? previous.asOf : null,
      error: error instanceof Error ? error.message : "sweep failed",
      elapsedMs: Date.now() - started,
    }, { status: previous ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  }
}
