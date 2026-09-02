import { getAddress, isAddress } from "viem";
import { addressesFor, chainOf, type ChainSlug } from "../chains.js";
import { loadEnv } from "../config/env.js";
import { makePublicClient } from "../signer/broadcast.js";
import { activeMarkets, type CuratedMarket } from "./catalog.js";
import { selectBestVenue, type VenueKey, type VenueObservation, type VenueProtocol, type VenueSelection } from "./venue-selection.js";

type GeckoRelationship = { data: { id: string } };

export type GeckoVenuePool = {
  attributes: {
    address?: string;
    pool_fee_percentage?: string;
    pool_created_at?: string;
    reserve_in_usd?: string;
    volume_usd?: { h24?: string };
    price_change_percentage?: { h24?: string };
    base_token_price_usd?: string;
    quote_token_price_usd?: string;
  };
  relationships: {
    base_token: GeckoRelationship;
    quote_token: GeckoRelationship;
    dex: GeckoRelationship;
  };
};

export type GeckoVenuePayload = { data?: GeckoVenuePool[] };

export type DexVenuePair = {
  pairAddress?: string;
  url?: string;
  dexId?: string;
  labels?: string[];
  baseToken: { address: string };
  quoteToken: { address: string };
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  pairCreatedAt?: number;
};

export type DexVenuePayload = { pairs?: DexVenuePair[] | null };

type ReviewedVenue = {
  key: VenueKey;
  protocol: VenueProtocol;
  poolReference: `0x${string}`;
  feePips: number;
  executable: boolean;
};

const ENTRY_GAS_UNITS: Record<VenueProtocol, number> = {
  V2: 700_000,
  V3: 900_000,
  V4: 1_100_000,
  AERODROME_SLIPSTREAM: 950_000,
};

export function deriveVenueObservations(
  chain: ChainSlug,
  market: CuratedMarket,
  payload: GeckoVenuePayload,
  observedAt = new Date().toISOString(),
  gasPriceWei?: bigint,
): VenueObservation[] {
  const pools = new Map((payload.data ?? []).flatMap((pool) => {
    const reference = pool.attributes.address?.toLowerCase();
    return reference ? [[reference, pool] as const] : [];
  }));
  return reviewedVenues(market).map((venue) => {
    const pool = pools.get(venue.poolReference.toLowerCase());
    const liquidityUsd = numeric(pool?.attributes.reserve_in_usd);
    const volume24hUsd = numeric(pool?.attributes.volume_usd?.h24);
    const createdAt = pool?.attributes.pool_created_at ? Date.parse(pool.attributes.pool_created_at) : Number.NaN;
    const observedAtMs = Date.parse(observedAt);
    const poolAgeDays = Number.isFinite(createdAt) && Number.isFinite(observedAtMs)
      ? Math.max(0, (observedAtMs - createdAt) / 86_400_000)
      : null;
    const ethPriceUsd = pool ? quoteAssetPriceUsd(chain, pool) : null;
    return {
      ...venue,
      pairVerified: pool ? poolMatchesMarket(chain, market, venue.key, pool) : false,
      liquidityUsd,
      volume24hUsd,
      feePips: liveFeePips(pool) ?? venue.feePips,
      poolAgeDays,
      priceChange24hPct: numeric(pool?.attributes.price_change_percentage?.h24),
      estimatedEntryCostUsd: gasPriceWei !== undefined && ethPriceUsd !== null
        ? Number(gasPriceWei) / 1e18 * ENTRY_GAS_UNITS[venue.protocol] * ethPriceUsd
        : null,
      observedAt,
      sourceUrl: `https://www.geckoterminal.com/${chain}/pools/${venue.poolReference.toLowerCase()}`,
    };
  });
}

export function deriveDexVenueObservations(
  chain: ChainSlug,
  market: CuratedMarket,
  payload: DexVenuePayload,
  observedAt = new Date().toISOString(),
  gasPriceWei?: bigint,
): VenueObservation[] {
  const sourceByReference = new Map<string, string>();
  const data = (payload.pairs ?? []).flatMap((pair): GeckoVenuePool[] => {
    if (!pair.pairAddress) return [];
    if (pair.url) sourceByReference.set(pair.pairAddress.toLowerCase(), pair.url);
    return [{
      attributes: {
        address: pair.pairAddress,
        pool_created_at: pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : undefined,
        reserve_in_usd: pair.liquidity?.usd === undefined ? undefined : String(pair.liquidity.usd),
        volume_usd: { h24: pair.volume?.h24 === undefined ? undefined : String(pair.volume.h24) },
        price_change_percentage: { h24: pair.priceChange?.h24 === undefined ? undefined : String(pair.priceChange.h24) },
      },
      relationships: {
        base_token: { data: { id: `${chain}_${pair.baseToken.address.toLowerCase()}` } },
        quote_token: { data: { id: `${chain}_${pair.quoteToken.address.toLowerCase()}` } },
        dex: { data: { id: pair.dexId ?? "unknown" } },
      },
    }];
  });
  return deriveVenueObservations(chain, market, { data }, observedAt, gasPriceWei).map((observation) => ({
    ...observation,
    sourceUrl: sourceByReference.get(observation.poolReference.toLowerCase()) ?? observation.sourceUrl,
  }));
}

export async function fetchVenueObservations(
  chain: ChainSlug,
  market: CuratedMarket,
  options: { observedAt?: string; gasPriceWei?: bigint; fetcher?: typeof fetch } = {},
): Promise<VenueObservation[]> {
  const observedAt = options.observedAt ?? new Date().toISOString();
  const references = reviewedVenues(market).map((venue) => venue.poolReference.toLowerCase()).join(",");
  const request: RequestInit & { next: { revalidate: number } } = {
    headers: { Accept: "application/json", "User-Agent": "Wizzy-Venue-Selector/1" },
    signal: AbortSignal.timeout(5_000),
    next: { revalidate: 60 },
  };
  try {
    const dexResponse = await (options.fetcher ?? fetch)(
      `https://api.dexscreener.com/latest/dex/pairs/${chain}/${references}`,
      request,
    );
    if (dexResponse.ok) {
      const dexPayload = await dexResponse.json() as DexVenuePayload;
      if (dexPayload.pairs?.length) return deriveDexVenueObservations(chain, market, dexPayload, observedAt, options.gasPriceWei);
    }
  } catch {
    // The lower-rate fallback below preserves a live decision when possible.
  }
  try {
    const response = await (options.fetcher ?? fetch)(
      `https://api.geckoterminal.com/api/v2/networks/${chain}/pools/multi/${references}?include=base_token%2Cquote_token%2Cdex`,
      request,
    );
    if (!response.ok) return deriveVenueObservations(chain, market, {}, observedAt, options.gasPriceWei);
    return deriveVenueObservations(chain, market, await response.json() as GeckoVenuePayload, observedAt, options.gasPriceWei);
  } catch {
    return deriveVenueObservations(chain, market, {}, observedAt, options.gasPriceWei);
  }
}

export async function selectBestMarketVenue(chain: ChainSlug, marketId: string): Promise<VenueSelection> {
  const market = activeMarkets(chain, [marketId])[0];
  if (!market) throw new Error("Choose an active reviewed market");
  const env = loadEnv();
  const client = makePublicClient(env.rpcByChain[chain], chainOf(chain).viem);
  const gasPriceWei = await client.getGasPrice().catch(() => undefined);
  const observedAt = new Date().toISOString();
  const observations = await fetchVenueObservations(chain, market, { observedAt, gasPriceWei });
  return selectBestVenue(observations, { now: observedAt });
}

function reviewedVenues(market: CuratedMarket): ReviewedVenue[] {
  return [
    {
      key: "PRIMARY",
      protocol: market.protocol,
      poolReference: market.pool,
      feePips: market.fee,
      executable: true,
    },
    ...market.liquidityVenues.map((venue): ReviewedVenue => venue.protocol === "V2"
      ? { key: "V2", protocol: "V2", poolReference: venue.pool, feePips: 3_000, executable: true }
      : {
          key: "V4",
          protocol: "V4",
          poolReference: venue.poolId as `0x${string}`,
          feePips: venue.fee,
          executable: isAddress(venue.hooks) && venue.tickSpacing > 0,
        }),
  ];
}

function poolMatchesMarket(chain: ChainSlug, market: CuratedMarket, key: VenueKey, pool: GeckoVenuePool): boolean {
  const base = relationshipAddress(pool.relationships.base_token.data.id);
  const quote = relationshipAddress(pool.relationships.quote_token.data.id);
  if (!base || !quote) return false;
  const pair = new Set([base.toLowerCase(), quote.toLowerCase()]);
  const expectedQuote = key === "V4" ? addressesFor(chain).nativeEth : market.quoteToken;
  return pair.has(market.token.toLowerCase()) && pair.has(expectedQuote.toLowerCase());
}

function quoteAssetPriceUsd(chain: ChainSlug, pool: GeckoVenuePool): number | null {
  const base = relationshipAddress(pool.relationships.base_token.data.id)?.toLowerCase();
  const quote = relationshipAddress(pool.relationships.quote_token.data.id)?.toLowerCase();
  const quoteAssets = new Set([addressesFor(chain).weth.toLowerCase(), addressesFor(chain).nativeEth.toLowerCase()]);
  if (base && quoteAssets.has(base)) return numeric(pool.attributes.base_token_price_usd);
  if (quote && quoteAssets.has(quote)) return numeric(pool.attributes.quote_token_price_usd);
  return null;
}

function relationshipAddress(id: string): string | null {
  const separator = id.indexOf("_");
  const value = separator >= 0 ? id.slice(separator + 1) : id;
  return isAddress(value) ? getAddress(value) : null;
}

function liveFeePips(pool: GeckoVenuePool | undefined): number | null {
  const feePercent = numeric(pool?.attributes.pool_fee_percentage);
  return feePercent !== null && feePercent > 0 ? Math.round(feePercent * 10_000) : null;
}

function numeric(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
