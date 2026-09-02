// Next's client bundler resolves app-local TypeScript modules extensionlessly.
// @ts-ignore NodeNext test resolution requires .js while Turbopack requires the source path.
import { readJsonPayload } from "./api-payload";
// @ts-ignore NodeNext test resolution requires .js while Turbopack requires the source path.
import type { ChainSlug } from "./chains";

const POSITION_CHAINS = ["base", "robinhood"] as const;

export type ChainPositionRows = {
  chain: ChainSlug;
  rows: unknown[];
  ethUsd?: number;
};

export type PositionLoadResult = {
  rows: unknown[];
  failedChains: ChainSlug[];
  errors: Error[];
  ethUsd: Partial<Record<ChainSlug, number>>;
};

/**
 * Reads both chains in parallel. `onChain` fires as soon as each chain lands so
 * a slow RPC on one network never hides positions on the other.
 */
export async function loadPositionRows(
  owner: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 25_000,
  onChain?: (result: ChainPositionRows) => void,
): Promise<PositionLoadResult> {
  const requests = POSITION_CHAINS.map(async (chain): Promise<ChainPositionRows> => {
    const response = await fetcher(`/api/positions?owner=${encodeURIComponent(owner)}&chain=${chain}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await readJsonPayload(response) as { positions?: unknown[]; ethUsd?: number; error?: string };
    if (!response.ok || payload.error) throw new Error(payload.error ?? `Could not load ${chain} positions`);
    const result: ChainPositionRows = { chain, rows: payload.positions ?? [], ethUsd: typeof payload.ethUsd === "number" && payload.ethUsd > 0 ? payload.ethUsd : undefined };
    onChain?.(result);
    return result;
  });
  const settled = await Promise.allSettled(requests);
  const rows: unknown[] = [];
  const failedChains: ChainSlug[] = [];
  const errors: Error[] = [];
  const ethUsd: Partial<Record<ChainSlug, number>> = {};
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      rows.push(...result.value.rows);
      if (result.value.ethUsd) ethUsd[result.value.chain] = result.value.ethUsd;
      return;
    }
    failedChains.push(POSITION_CHAINS[index]!);
    errors.push(result.reason instanceof Error ? result.reason : new Error(String(result.reason)));
  });
  return { rows, failedChains, errors, ethUsd };
}
