import { head, put } from "@vercel/blob";
import type { PoolsPayload } from "./portfolio-types";

/**
 * One snapshot, one writer. The cron sweep writes `pools/latest.json` to the
 * project's Blob store; every API instance reads it. Without a store token
 * (local dev, or a misconfigured deploy) the API falls back to a per-process
 * sweep so the page still works.
 */
export const SNAPSHOT_PATHNAME = "pools/latest.json";
const BLOB_CACHE_SECONDS = 60;

export function snapshotStoreConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function readSnapshot(): Promise<PoolsPayload | null> {
  if (!snapshotStoreConfigured()) return null;
  let url: string;
  try {
    url = (await head(SNAPSHOT_PATHNAME)).url;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Snapshot read failed: ${response.status}`);
  const payload = await response.json() as PoolsPayload;
  if (!Array.isArray(payload.pools) || typeof payload.asOf !== "string") throw new Error("Snapshot is malformed");
  return payload;
}

export async function writeSnapshot(snapshot: PoolsPayload): Promise<string> {
  const result = await put(SNAPSHOT_PATHNAME, JSON.stringify(snapshot), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: BLOB_CACHE_SECONDS,
  });
  return result.url;
}

function isNotFound(error: unknown): boolean {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
  const message = error instanceof Error ? error.message : String(error);
  return name === "BlobNotFoundError" || /not found|404/i.test(message);
}
