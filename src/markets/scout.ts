import type { ChainSlug } from "../chains.js";
import { getMarketCatalog } from "./catalog.js";
import { fetchMarketStats, type MarketStats } from "./stats.js";

export type MarketScoutRow = {
  marketId: string;
  chain: ChainSlug;
  symbol: string;
  status: "included" | "watch";
  risk: "established" | "emerging" | "experimental";
  rangeWidthPct: number;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24h: number | null;
  trailingFeeAprPct: number | null;
  signals: string[];
  warnings: string[];
  sourceUrl: string | null;
  asOf: string;
};

/**
 * Deterministic evidence packet for the curator. Catalog changes remain
 * bounded by the policy engine and reviewed-pool checks.
 */
export async function scoutMarkets(chain?: ChainSlug): Promise<{
  role: "advisory";
  catalogVersion: number;
  updatedAt: string;
  methodology: string[];
  markets: MarketScoutRow[];
}> {
  const catalog = getMarketCatalog();
  const live = await fetchMarketStats();
  const byId = new Map(live.map((row) => [row.marketId, row]));
  const rows = catalog.chains
    .filter((entry) => !chain || entry.slug === chain)
    .flatMap((entry) => entry.markets.map((market) => scoutRow(entry.slug, market, byId.get(market.id))));
  return {
    role: "advisory",
    catalogVersion: catalog.version,
    updatedAt: catalog.updatedAt,
    methodology: [
      "Market membership comes from the version-controlled reviewed catalog.",
      "Liquidity, volume, price movement, and fee pace are short-window market signals, not return forecasts.",
      "The curator may apply a policy-valid replacement; hard security failures pause new deposits.",
    ],
    markets: rows,
  };
}

function scoutRow(
  chain: ChainSlug,
  market: ReturnType<typeof getMarketCatalog>["chains"][number]["markets"][number],
  stats?: MarketStats,
): MarketScoutRow {
  const signals: string[] = [];
  const warnings: string[] = [];
  if (stats?.liquidityUsd !== null && stats?.liquidityUsd !== undefined) {
    if (stats.liquidityUsd >= 1_000_000) signals.push("at least $1m pool liquidity");
    else if (stats.liquidityUsd >= 250_000) signals.push("at least $250k pool liquidity");
    else warnings.push("pool liquidity below $250k review floor");
  } else {
    warnings.push("live pool liquidity unavailable");
  }
  if (stats?.volume24hUsd !== null && stats?.volume24hUsd !== undefined) {
    if (stats.volume24hUsd >= 100_000) signals.push("at least $100k 24h volume");
    else warnings.push("24h volume is thin; fee pace may be noisy");
  }
  if (stats?.priceChange24h !== null && stats?.priceChange24h !== undefined && Math.abs(stats.priceChange24h) >= 20) {
    warnings.push("24h price move exceeds 20%; range and divergence risk are elevated");
  }
  if (market.risk === "emerging") warnings.push("emerging asset: wider range and closer review required");
  if (market.status !== "active") warnings.push(`catalog status is ${market.status}`);
  return {
    marketId: market.id,
    chain,
    symbol: market.symbol,
    status: market.status === "active" ? "included" : "watch",
    risk: market.risk,
    rangeWidthPct: market.rangeWidthPct,
    liquidityUsd: stats?.liquidityUsd ?? null,
    volume24hUsd: stats?.volume24hUsd ?? null,
    priceChange24h: stats?.priceChange24h ?? null,
    trailingFeeAprPct: stats?.trailingFeeAprPct ?? null,
    signals,
    warnings,
    sourceUrl: stats?.sourceUrl ?? null,
    asOf: stats?.asOf ?? new Date().toISOString(),
  };
}
