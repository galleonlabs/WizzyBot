import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type HoldSource =
  | "increase-liquidity-log"
  | "mint-transfer-log"
  | "first-seen-import"
  | "live-mint";

export interface HoldRecord {
  tokenId: string;
  hold0: string;
  hold1: string;
  createdAt: number;
  source: HoldSource;
  note?: string;
}

export interface HoldStoreFile {
  version: 1;
  positions: Record<string, HoldRecord>;
}

export const HOLD_LIMITATION =
  "HOLD is unknown until first import. Positions minted before first import cannot reconstruct the original bag unless Transfer + IncreaseLiquidity logs (or a live subgraph) are available. After import, first-seen amounts are persisted in ~/.unabot/positions.json and reused — current amounts are never silently treated as HOLD.";

export function defaultHoldPath(): string {
  return join(homedir(), ".unabot", "positions.json");
}

export function emptyStore(): HoldStoreFile {
  return { version: 1, positions: {} };
}

export function loadHoldStore(path = defaultHoldPath()): HoldStoreFile {
  if (!existsSync(path)) return emptyStore();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<HoldStoreFile>;
    if (raw.version !== 1 || !raw.positions || typeof raw.positions !== "object") return emptyStore();
    return { version: 1, positions: raw.positions };
  } catch {
    return emptyStore();
  }
}

export function saveHoldStore(store: HoldStoreFile, path = defaultHoldPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2) + "\n");
}

export function getHold(tokenId: bigint | string, path = defaultHoldPath()): HoldRecord | undefined {
  return loadHoldStore(path).positions[String(tokenId)];
}

/**
 * Persist HOLD only on first sight. Never overwrite a real mint/log baseline
 * with later current amounts.
 */
export function rememberHold(
  tokenId: bigint | string,
  hold0: bigint,
  hold1: bigint,
  source: HoldSource,
  opts: { createdAt?: number; note?: string; path?: string } = {},
): { record: HoldRecord; created: boolean } {
  const path = opts.path ?? defaultHoldPath();
  const store = loadHoldStore(path);
  const id = String(tokenId);
  const existing = store.positions[id];
  if (existing) return { record: existing, created: false };
  const record: HoldRecord = {
    tokenId: id,
    hold0: hold0.toString(),
    hold1: hold1.toString(),
    createdAt: opts.createdAt ?? Math.floor(Date.now() / 1000),
    source,
    note: opts.note,
  };
  store.positions[id] = record;
  saveHoldStore(store, path);
  return { record, created: true };
}

export function holdAmounts(record: HoldRecord): { hold0: bigint; hold1: bigint } {
  return { hold0: BigInt(record.hold0), hold1: BigInt(record.hold1) };
}

export function holdIsReconstructed(record: HoldRecord): boolean {
  return record.source === "increase-liquidity-log" || record.source === "mint-transfer-log" || record.source === "live-mint";
}

export function formatHoldNote(record: HoldRecord | undefined): string {
  if (!record) return HOLD_LIMITATION;
  if (record.source === "first-seen-import") {
    return (
      record.note ??
      "HOLD is first-seen inventory at import, not the original mint bag (logs/subgraph unavailable)."
    );
  }
  return `HOLD source=${record.source} createdAt=${record.createdAt}`;
}
