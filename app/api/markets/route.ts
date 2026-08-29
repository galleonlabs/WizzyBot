import { NextResponse } from "next/server";
import { fetchMarketStats, getMarketCatalog } from "../../lib/portfolio-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const catalog = getMarketCatalog();
  const stats = await fetchMarketStats().catch(() => []);
  return NextResponse.json({ catalog, stats, source: "version-controlled catalog + live DEXScreener pool data" });
}
