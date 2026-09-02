// Next's client bundler resolves app-local TypeScript modules extensionlessly.
// @ts-ignore NodeNext test resolution requires .js while Turbopack requires the source path.
import { readJsonPayload } from "./api-payload";
// @ts-ignore NodeNext test resolution requires .js while Turbopack requires the source path.
import type { ChainSlug } from "./chains";

const POSITION_CHAINS = ["base", "robinhood"] as const;

export type PositionLoadResult = {
  rows: unknown[];
  failedChains: ChainSlug[];
  errors: Error[];
};

export async function loadPositionRows(
  owner: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 25_000,
): Promise<PositionLoadResult> {
  const requests = POSITION_CHAINS.map(async (chain) => {
    const response = await fetcher(`/api/positions?owner=${encodeURIComponent(owner)}&chain=${chain}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await readJsonPayload(response) as { positions?: unknown[]; error?: string };
    if (!response.ok || payload.error) throw new Error(payload.error ?? `Could not load ${chain} positions`);
    return { chain, rows: payload.positions ?? [] };
  });
  const settled = await Promise.allSettled(requests);
  const rows: unknown[] = [];
  const failedChains: ChainSlug[] = [];
  const errors: Error[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      rows.push(...result.value.rows);
      return;
    }
    failedChains.push(POSITION_CHAINS[index]!);
    errors.push(result.reason instanceof Error ? result.reason : new Error(String(result.reason)));
  });
  return { rows, failedChains, errors };
}
