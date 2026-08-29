import { NextResponse } from "next/server";
import { fetchMarketStats, fetchSolanaMarketStats, getMarketCatalog, getSolanaMarketCatalog } from "../../lib/portfolio-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const catalog = getMarketCatalog();
  const solana = getSolanaMarketCatalog();
  const [evmStats, solanaStats] = await Promise.all([
    fetchMarketStats().catch(() => []),
    fetchSolanaMarketStats().catch(() => []),
  ]);
  return NextResponse.json({ catalog, solana, stats: [...evmStats as unknown[], ...solanaStats as unknown[]], source: "version-controlled index + live DEXScreener pool data" });
}
