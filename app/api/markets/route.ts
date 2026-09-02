import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { ETH_FUNDING_CHAINS, fetchMarketStats, fetchSolanaMarketStats, getMarketCatalog, getSolanaMarketCatalog } from "../../lib/portfolio-server";

export const runtime = "nodejs";
export const revalidate = 30;

const catalog = getMarketCatalog() as { version: number };

const getMarketsPayload = unstable_cache(async () => {
  const solana = getSolanaMarketCatalog();
  const [evmStats, solanaStats] = await Promise.all([
    fetchMarketStats().catch(() => []),
    fetchSolanaMarketStats().catch(() => []),
  ]);
  return {
    catalog,
    solana,
    fundingChains: ETH_FUNDING_CHAINS,
    stats: [...evmStats as unknown[], ...solanaStats as unknown[]],
    source: "version-controlled market catalog + live pool data",
  };
}, ["wizzy-markets-v3", String(catalog.version)], { revalidate: 30, tags: ["markets"] });

export async function GET() {
  return NextResponse.json(await getMarketsPayload(), {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" },
  });
}
