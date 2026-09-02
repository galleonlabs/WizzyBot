import type { ChainSlug } from "../chains.js";
import { getMarketCatalog, type CuratedMarket } from "./catalog.js";
import { slipstreamPoolAbi } from "../aerodrome/abi.js";
import { loadEnv } from "../config/env.js";
import { makePublicClient } from "../signer/broadcast.js";
import { viemChainFor } from "../chains.js";

type DexPair = {
  url?: string;
  info?: { imageUrl?: string };
  priceUsd?: string;
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  marketCap?: number;
  fdv?: number;
  pairCreatedAt?: number;
};

type GeckoPool = {
  id: string;
  attributes: {
    address?: string;
    base_token_price_usd?: string;
    quote_token_price_usd?: string;
    price_change_percentage?: { h24?: string };
    reserve_in_usd?: string;
    volume_usd?: { h24?: string };
    market_cap_usd?: string | null;
    fdv_usd?: string | null;
    pool_created_at?: string;
  };
  relationships: {
    base_token: { data: { id: string } };
    quote_token: { data: { id: string } };
  };
};

type GeckoToken = {
  id: string;
  attributes: {
    address?: string;
    image_url?: string | null;
  };
};

export type MarketStats = {
  marketId: string;
  tokenImageUrl: string | null;
  feePips: number;
  priceUsd: number | null;
  priceChange24h: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  marketCapUsd: number | null;
  trailingFeeAprPct: number | null;
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

export function deriveGeckoMarketStats(
  market: CuratedMarket,
  pool: GeckoPool | undefined,
  tokens: GeckoToken[] = [],
  asOf = new Date().toISOString(),
): MarketStats {
  const tokenId = pool
    ? [pool.relationships.base_token.data.id, pool.relationships.quote_token.data.id]
      .find((id) => id.toLowerCase().endsWith(`_${market.token.toLowerCase()}`))
    : undefined;
  const memeIsBase = tokenId === pool?.relationships.base_token.data.id;
  const token = tokens.find((candidate) => candidate.id === tokenId);
  const createdAt = pool?.attributes.pool_created_at ? Date.parse(pool.attributes.pool_created_at) : Number.NaN;
  return deriveMarketStats(market, pool ? {
    url: `https://www.geckoterminal.com/robinhood/pools/${market.pool.toLowerCase()}`,
    info: { imageUrl: token?.attributes.image_url ?? undefined },
    priceUsd: memeIsBase ? pool.attributes.base_token_price_usd : pool.attributes.quote_token_price_usd,
    priceChange: { h24: finite(pool.attributes.price_change_percentage?.h24) ?? undefined },
    liquidity: { usd: finite(pool.attributes.reserve_in_usd) ?? undefined },
    volume: { h24: finite(pool.attributes.volume_usd?.h24) ?? undefined },
    marketCap: finite(pool.attributes.market_cap_usd ?? pool.attributes.fdv_usd) ?? undefined,
    pairCreatedAt: Number.isFinite(createdAt) ? createdAt : undefined,
  } : undefined, asOf);
}

export function deriveMarketStats(
  market: CuratedMarket,
  pair: DexPair | undefined,
  asOf = new Date().toISOString(),
  feePips = market.fee,
): MarketStats {
  const priceUsd = finite(pair?.priceUsd);
  const priceChange24h = finite(pair?.priceChange?.h24);
  const liquidityUsd = finite(pair?.liquidity?.usd);
  const volume24hUsd = finite(pair?.volume?.h24);
  const marketCapUsd = finite(pair?.marketCap ?? pair?.fdv);
  const trailingFeeAprPct = liquidityUsd && liquidityUsd > 0 && volume24hUsd !== null
    ? (volume24hUsd * (feePips / 1_000_000) * 365 * 100) / liquidityUsd
    : null;
  const activity = liquidityUsd && liquidityUsd > 0 && volume24hUsd !== null ? volume24hUsd / liquidityUsd : null;
  const poolAgeDays = pair?.pairCreatedAt
    ? Math.max(0, (Date.parse(asOf) - pair.pairCreatedAt) / 86_400_000)
    : null;
  const energy = activity === null
    ? null
    : Math.max(0, Math.min(100, Math.round(25 * Math.log10(1 + activity * 100) + (liquidityUsd! >= 1_000_000 ? 25 : 10))));
  return {
    marketId: market.id,
    tokenImageUrl: pair?.info?.imageUrl ?? market.imageUrl ?? null,
    feePips,
    priceUsd,
    priceChange24h,
    liquidityUsd,
    volume24hUsd,
    marketCapUsd,
    trailingFeeAprPct,
    poolAgeDays,
    energy,
    sourceUrl: pair?.url ?? null,
    asOf,
  };
}

export async function fetchMarketStats(): Promise<MarketStats[]> {
  const catalog = getMarketCatalog();
  const asOf = new Date().toISOString();
  const env = loadEnv();
  const baseClient = makePublicClient(env.rpcByChain.base, viemChainFor("base"));
  const base = catalog.chains.find((chain) => chain.slug === "base")!;
  const robinhood = catalog.chains.find((chain) => chain.slug === "robinhood")!;
  const baseStats = await Promise.all(base.markets.map(async (market) => {
    let feePips = market.fee;
    if (market.protocol === "AERODROME_SLIPSTREAM") {
      try {
        feePips = await baseClient.readContract({ address: market.pool, abi: slipstreamPoolAbi, functionName: "fee" });
      } catch {
        // Retain the code-reviewed snapshot when the RPC is temporarily unavailable.
      }
    }
    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${dexChain(base.slug)}/${market.pool}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return deriveMarketStats(market, undefined, asOf, feePips);
      const payload = await response.json() as { pair?: DexPair; pairs?: DexPair[] };
      return deriveMarketStats(market, payload.pair ?? payload.pairs?.[0], asOf, feePips);
    } catch {
      return deriveMarketStats(market, undefined, asOf, feePips);
    }
  }));
  const robinhoodStats = await fetchRobinhoodStats(robinhood.markets, asOf);
  return [...baseStats, ...robinhoodStats];
}

async function fetchRobinhoodStats(markets: CuratedMarket[], asOf: string): Promise<MarketStats[]> {
  if (!markets.length) return [];
  const addresses = markets.map((market) => market.pool.toLowerCase()).join(",");
  try {
    const request: RequestInit & { next: { revalidate: number } } = {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      next: { revalidate: 60 },
    };
    const response = await fetch(`https://api.geckoterminal.com/api/v2/networks/robinhood/pools/multi/${addresses}?include=base_token%2Cquote_token%2Cdex`, request);
    if (!response.ok) return markets.map((market) => deriveGeckoMarketStats(market, undefined, [], asOf));
    const payload = await response.json() as { data?: GeckoPool[]; included?: GeckoToken[] };
    const pools = new Map((payload.data ?? []).map((pool) => [pool.attributes.address?.toLowerCase() ?? "", pool]));
    return markets.map((market) => deriveGeckoMarketStats(market, pools.get(market.pool.toLowerCase()), payload.included ?? [], asOf));
  } catch {
    return markets.map((market) => deriveGeckoMarketStats(market, undefined, [], asOf));
  }
}
