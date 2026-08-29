import type { ChainSlug } from "../chains.js";
import { getMarketCatalog, type CuratedMarket } from "./catalog.js";

type DexPair = {
  url?: string;
  priceUsd?: string;
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  marketCap?: number;
  fdv?: number;
  pairCreatedAt?: number;
};

export type MarketStats = {
  marketId: string;
  priceUsd: number | null;
  priceChange24h: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  marketCapUsd: number | null;
  trailingFeeAprPct: number | null;
  dailyFeesPer1000Usd: number | null;
  projectedMonthlyFeesPer1000Usd: number | null;
  projectionConfidence: "illustrative" | "unstable" | "unavailable";
  poolAgeDays: number | null;
  energy: number | null;
  sourceUrl: string | null;
  asOf: string;
};

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function dexChain(slug: ChainSlug): string {
  return slug === "robinhood" ? "robinhood" : "base";
}

export function deriveMarketStats(market: CuratedMarket, pair: DexPair | undefined, asOf = new Date().toISOString()): MarketStats {
  const priceUsd = finite(pair?.priceUsd);
  const priceChange24h = finite(pair?.priceChange?.h24);
  const liquidityUsd = finite(pair?.liquidity?.usd);
  const volume24hUsd = finite(pair?.volume?.h24);
  const marketCapUsd = finite(pair?.marketCap ?? pair?.fdv);
  const trailingFeeAprPct = liquidityUsd && liquidityUsd > 0 && volume24hUsd !== null
    ? (volume24hUsd * (market.fee / 1_000_000) * 365 * 100) / liquidityUsd
    : null;
  const activity = liquidityUsd && liquidityUsd > 0 && volume24hUsd !== null ? volume24hUsd / liquidityUsd : null;
  const poolAgeDays = pair?.pairCreatedAt
    ? Math.max(0, (Date.parse(asOf) - pair.pairCreatedAt) / 86_400_000)
    : null;
  const dailyFeesPer1000Usd = activity === null ? null : activity * (market.fee / 1_000_000) * 1_000;
  const projectionConfidence = trailingFeeAprPct === null
    ? "unavailable"
    : poolAgeDays === null || poolAgeDays < 30 || activity === null || activity > 1 || Math.abs(priceChange24h ?? 0) >= 20
      ? "unstable"
      : "illustrative";
  const projectedMonthlyFeesPer1000Usd = projectionConfidence === "illustrative" && trailingFeeAprPct !== null
    ? (1_000 * trailingFeeAprPct) / 100 / 12
    : null;
  const energy = activity === null
    ? null
    : Math.max(0, Math.min(100, Math.round(25 * Math.log10(1 + activity * 100) + (liquidityUsd! >= 1_000_000 ? 25 : 10))));
  return {
    marketId: market.id,
    priceUsd,
    priceChange24h,
    liquidityUsd,
    volume24hUsd,
    marketCapUsd,
    trailingFeeAprPct,
    dailyFeesPer1000Usd,
    projectedMonthlyFeesPer1000Usd,
    projectionConfidence,
    poolAgeDays,
    energy,
    sourceUrl: pair?.url ?? null,
    asOf,
  };
}

export async function fetchMarketStats(): Promise<MarketStats[]> {
  const catalog = getMarketCatalog();
  const asOf = new Date().toISOString();
  return Promise.all(catalog.chains.flatMap((chain) => chain.markets.map(async (market) => {
    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${dexChain(chain.slug)}/${market.pool}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return deriveMarketStats(market, undefined, asOf);
      const payload = await response.json() as { pair?: DexPair; pairs?: DexPair[] };
      return deriveMarketStats(market, payload.pair ?? payload.pairs?.[0], asOf);
    } catch {
      return deriveMarketStats(market, undefined, asOf);
    }
  })));
}
