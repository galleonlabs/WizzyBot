import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { getStableCatalog } from "../../../lib/portfolio-server";

export const runtime = "nodejs";
export const revalidate = 300;

type VaultLive = { address: string; netApy: number | null; totalAssetsUsd: number | null };

const MORPHO_QUERY = `{
  vaults(first: 24, where: { chainId_in: [8453], assetSymbol_in: ["USDC"] }) {
    items { address state { netApy totalAssetsUsd } }
  }
}`;

async function fetchLiveVaultStats(): Promise<Map<string, VaultLive>> {
  const response = await fetch("https://blue-api.morpho.org/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: MORPHO_QUERY }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Morpho API ${response.status}`);
  const payload = await response.json() as {
    data?: { vaults?: { items?: Array<{ address: string; state?: { netApy?: number; totalAssetsUsd?: number } }> } };
  };
  const rows = payload.data?.vaults?.items ?? [];
  return new Map(rows.map((row) => [row.address.toLowerCase(), {
    address: row.address,
    netApy: row.state?.netApy ?? null,
    totalAssetsUsd: row.state?.totalAssetsUsd ?? null,
  }]));
}

const getStableMarketsPayload = unstable_cache(async () => {
  const catalog = getStableCatalog() as {
    version: number;
    updatedAt: string;
    asset: unknown;
    fees: unknown;
    minimumDepositUnits: string;
    vaults: Array<Record<string, unknown> & { vault: string; weightBps: number; status: string }>;
  };
  const live = await fetchLiveVaultStats().catch(() => new Map<string, VaultLive>());
  const vaults = catalog.vaults.map((vault) => {
    const stats = live.get(vault.vault.toLowerCase());
    return { ...vault, netApy: stats?.netApy ?? null, totalAssetsUsd: stats?.totalAssetsUsd ?? null };
  });
  const active = vaults.filter((vault) => vault.status === "active");
  const weighted = active.reduce((sum, vault) => sum + (vault.netApy ?? 0) * vault.weightBps, 0);
  const covered = active.reduce((sum, vault) => sum + (vault.netApy === null ? 0 : vault.weightBps), 0);
  return {
    version: catalog.version,
    updatedAt: catalog.updatedAt,
    asset: catalog.asset,
    fees: catalog.fees,
    minimumDepositUnits: catalog.minimumDepositUnits,
    vaults,
    blendedNetApy: covered > 0 ? weighted / covered : null,
    source: "version-controlled vault catalog + live Morpho data",
  };
}, ["wizzy-stable-markets-v1"], { revalidate: 300, tags: ["stable-markets"] });

export async function GET() {
  return NextResponse.json(await getStableMarketsPayload(), {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" },
  });
}
