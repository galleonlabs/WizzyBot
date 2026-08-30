import { NextResponse } from "next/server";
import { ETH_FUNDING_CHAINS, fetchMarketStats, fetchSolanaMarketStats, getRobinhoodIndexState, getSolanaMarketCatalog } from "../../lib/portfolio-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const solana = getSolanaMarketCatalog();
  const [indexState, evmStats, solanaStats] = await Promise.all([
    getRobinhoodIndexState() as Promise<{ source: "catalog" | "onchain"; catalog: unknown; policy: unknown; registry: unknown }>,
    fetchMarketStats().catch(() => []),
    fetchSolanaMarketStats().catch(() => []),
  ]);
  return NextResponse.json({
    catalog: indexState.catalog,
    solana,
    index: indexState.policy,
    registry: indexState.registry,
    fundingChains: ETH_FUNDING_CHAINS,
    stats: [...evmStats as unknown[], ...solanaStats as unknown[]],
    source: `${indexState.source === "onchain" ? "onchain Robinhood index" : "version-controlled Robinhood index"} + live GeckoTerminal pool data`,
  });
}
