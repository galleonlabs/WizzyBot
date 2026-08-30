import { NextResponse } from "next/server";
import { ETH_FUNDING_CHAINS, fetchMarketStats, fetchSolanaMarketStats, getMarketCatalog, getRobinhoodIndexBreadthPolicy, getSolanaMarketCatalog } from "../../lib/portfolio-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const catalog = getMarketCatalog();
  const solana = getSolanaMarketCatalog();
  const index = getRobinhoodIndexBreadthPolicy();
  const [evmStats, solanaStats] = await Promise.all([
    fetchMarketStats().catch(() => []),
    fetchSolanaMarketStats().catch(() => []),
  ]);
  return NextResponse.json({ catalog, solana, index, fundingChains: ETH_FUNDING_CHAINS, stats: [...evmStats as unknown[], ...solanaStats as unknown[]], source: "version-controlled Robinhood index + live GeckoTerminal pool data" });
}
