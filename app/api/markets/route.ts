import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { ETH_FUNDING_CHAINS, fetchMarketStats, fetchSolanaMarketStats, getRobinhoodIndexState, getSolanaMarketCatalog } from "../../lib/portfolio-server";

export const runtime = "nodejs";
export const revalidate = 30;

const getMarketsPayload = unstable_cache(async () => {
  const solana = getSolanaMarketCatalog();
  const [catalogState, evmStats, solanaStats] = await Promise.all([
    getRobinhoodIndexState() as Promise<{ source: "catalog" | "onchain"; catalog: unknown }>,
    fetchMarketStats().catch(() => []),
    fetchSolanaMarketStats().catch(() => []),
  ]);
  return {
    catalog: catalogState.catalog,
    solana,
    fundingChains: ETH_FUNDING_CHAINS,
    stats: [...evmStats as unknown[], ...solanaStats as unknown[]],
    source: `${catalogState.source === "onchain" ? "onchain market catalog" : "version-controlled market catalog"} + live pool data`,
  };
}, ["wizzy-markets-v2"], { revalidate: 30, tags: ["markets"] });

export async function GET() {
  return NextResponse.json(await getMarketsPayload(), {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300" },
  });
}
