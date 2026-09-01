import { getAddress, isAddress } from "viem";
import { addressesFor, type ChainSlug } from "../chains.js";
import { getMarketCatalog } from "../markets/catalog.js";
import { getCuratorConfig, type CuratorPolicy } from "./config.js";

type GeckoRelationship = { data: { id: string } };

type GeckoPool = {
  attributes: {
    address?: string;
    name?: string;
    pool_fee_percentage?: string;
    pool_created_at?: string;
    reserve_in_usd?: string;
    volume_usd?: { h24?: string };
  };
  relationships: {
    base_token: GeckoRelationship;
    quote_token: GeckoRelationship;
    dex: GeckoRelationship;
  };
};

type GeckoToken = {
  id: string;
  type: "token";
  attributes: {
    address?: string;
    name?: string;
    symbol?: string;
    decimals?: number;
    coingecko_coin_id?: string | null;
  };
};

export type GeckoPoolsPayload = {
  data?: GeckoPool[];
  included?: Array<GeckoToken | { id: string; type: string; attributes?: unknown }>;
};

export type CuratorDiscovery = {
  id: string;
  kind: "candidate" | "venue";
  marketId?: string;
  chain: ChainSlug;
  name: string;
  symbol: string;
  token: `0x${string}`;
  pool: `0x${string}`;
  protocol: "V2" | "V3" | "V4";
  feePips: number;
  liquidityUsd: number;
  volume24hUsd: number;
  poolAgeDays: number;
  sourceUrl: string;
  dexId: string;
  executionReady: boolean;
  executionNote?: string;
  venues: CuratorDiscoveryVenue[];
};

export type CuratorDiscoveryVenue = {
  protocol: "V2" | "V3" | "V4";
  pool: `0x${string}`;
  feePips: number;
  liquidityUsd: number;
  volume24hUsd: number;
  poolAgeDays: number;
  sourceUrl: string;
  dexId: string;
  autoAttachable: boolean;
};

type DiscoveryOptions = {
  policy: CuratorPolicy;
  existingTokens: ReadonlySet<string>;
  existingPools: ReadonlySet<string>;
  trackedMarkets?: ReadonlyMap<string, string>;
  observedAt: string;
};

const NETWORKS: readonly ChainSlug[] = ["base", "robinhood"];
const EXCLUDED_SYMBOLS = new Set(["AERO", "CBBTC", "ETH", "USDC", "USDBC", "USDG", "USDT", "VIRTUAL", "WBTC", "WETH"]);
const EXCLUDED_COINGECKO_IDS = new Set([
  "aerodrome-finance",
  "coinbase-wrapped-btc",
  "global-dollar",
  "l2-standard-bridged-weth-base",
  "usd-coin",
  "virtual-protocol",
  "wrapped-bitcoin",
]);

function numeric(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function addressFromRelationship(id: string): string | null {
  const separator = id.indexOf("_");
  const address = separator >= 0 ? id.slice(separator + 1) : id;
  return isAddress(address) ? getAddress(address) : null;
}

function feePipsFromName(name: string): number | null {
  const match = name.match(/\b(0\.01|0\.05|0\.3|1)%\s*$/);
  if (!match) return null;
  return Math.round(Number(match[1]) * 10_000);
}

function protocolForDex(dexId: string, chain: ChainSlug): CuratorDiscoveryVenue["protocol"] | null {
  if (dexId === `uniswap-v2-${chain}`) return "V2";
  if (dexId === `uniswap-v3-${chain}`) return "V3";
  if (dexId === `uniswap-v4-${chain}`) return "V4";
  return null;
}

function poolReference(address: string | undefined, protocol: CuratorDiscoveryVenue["protocol"]): `0x${string}` | null {
  if (!address) return null;
  if (protocol === "V4") return /^0x[0-9a-fA-F]{64}$/.test(address) ? address.toLowerCase() as `0x${string}` : null;
  return isAddress(address) ? getAddress(address) : null;
}

function feePipsForPool(pool: GeckoPool, protocol: CuratorDiscoveryVenue["protocol"]): number | null {
  if (protocol === "V2") return 3_000;
  const explicit = numeric(pool.attributes.pool_fee_percentage);
  if (explicit !== null && explicit > 0) return Math.round(explicit * 10_000);
  return feePipsFromName(pool.attributes.name ?? "");
}

function discoveryId(chain: ChainSlug, symbol: string, token: string): string {
  const slug = symbol.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "token";
  return `${chain}-${slug}-${token.slice(2, 8).toLowerCase()}`;
}

export function extractCuratorDiscoveries(
  payloads: readonly GeckoPoolsPayload[],
  chain: ChainSlug,
  options: DiscoveryOptions,
): CuratorDiscovery[] {
  const tokenById = new Map<string, GeckoToken>();
  for (const payload of payloads) {
    for (const included of payload.included ?? []) {
      if (included.type === "token") tokenById.set(included.id.toLowerCase(), included as GeckoToken);
    }
  }
  const weth = addressesFor(chain).weth.toLowerCase();
  const observedAt = Date.parse(options.observedAt);
  const leads = new Map<string, {
    name: string;
    symbol: string;
    token: `0x${string}`;
    marketId?: string;
    venues: Map<string, CuratorDiscoveryVenue>;
  }>();

  for (const pool of payloads.flatMap((payload) => payload.data ?? [])) {
    const dexId = pool.relationships.dex.data.id;
    const protocol = protocolForDex(dexId, chain);
    if (!protocol) continue;
    const reference = poolReference(pool.attributes.address, protocol);
    if (!reference) continue;
    const baseAddress = addressFromRelationship(pool.relationships.base_token.data.id);
    const quoteAddress = addressFromRelationship(pool.relationships.quote_token.data.id);
    if (!baseAddress || !quoteAddress) continue;
    const tokenAddress = baseAddress.toLowerCase() === weth
      ? quoteAddress
      : quoteAddress.toLowerCase() === weth
        ? baseAddress
        : null;
    if (!tokenAddress || tokenAddress.toLowerCase() === weth) continue;
    if (options.existingTokens.has(tokenAddress.toLowerCase()) || options.existingPools.has(reference.toLowerCase())) continue;

    const liquidityUsd = numeric(pool.attributes.reserve_in_usd);
    const volume24hUsd = numeric(pool.attributes.volume_usd?.h24);
    const createdAt = pool.attributes.pool_created_at ? Date.parse(pool.attributes.pool_created_at) : Number.NaN;
    const poolAgeDays = Number.isFinite(createdAt) && Number.isFinite(observedAt)
      ? Math.max(0, (observedAt - createdAt) / 86_400_000)
      : null;
    const feePips = feePipsForPool(pool, protocol);
    if (liquidityUsd === null || liquidityUsd <= 0) continue;
    if (volume24hUsd === null || volume24hUsd <= 0) continue;
    if (poolAgeDays === null || poolAgeDays < options.policy.minimumPoolAgeDays) continue;
    if (feePips === null) continue;

    const tokenRelationshipId = baseAddress.toLowerCase() === tokenAddress.toLowerCase()
      ? pool.relationships.base_token.data.id
      : pool.relationships.quote_token.data.id;
    const token = tokenById.get(tokenRelationshipId.toLowerCase());
    const symbol = token?.attributes.symbol?.trim();
    const name = token?.attributes.name?.trim();
    if (!symbol || !name) continue;
    if (EXCLUDED_SYMBOLS.has(symbol.toUpperCase())) continue;
    if (token?.attributes.coingecko_coin_id && EXCLUDED_COINGECKO_IDS.has(token.attributes.coingecko_coin_id)) continue;

    const tokenAddressNormalized = getAddress(tokenAddress);
    const venue: CuratorDiscoveryVenue = {
      protocol,
      pool: reference,
      feePips,
      liquidityUsd,
      volume24hUsd,
      poolAgeDays,
      sourceUrl: `https://www.geckoterminal.com/${chain}/pools/${reference.toLowerCase()}`,
      dexId,
      // V4 discovery identifies the PoolId, but GeckoTerminal does not expose
      // the hooks-bearing pool key needed to prepare safe calldata.
      autoAttachable: protocol !== "V4",
    };
    const key = tokenAddressNormalized.toLowerCase();
    const lead = leads.get(key) ?? {
      name,
      symbol,
      token: tokenAddressNormalized,
      marketId: options.trackedMarkets?.get(key),
      venues: new Map(),
    };
    const venueKey = `${protocol}:${reference.toLowerCase()}`;
    const prior = lead.venues.get(venueKey);
    if (!prior || venue.volume24hUsd > prior.volume24hUsd) lead.venues.set(venueKey, venue);
    leads.set(key, lead);
  }

  return [...leads.values()].flatMap((lead): CuratorDiscovery[] => {
    const venues = [...lead.venues.values()].sort((a, b) => b.liquidityUsd - a.liquidityUsd || b.volume24hUsd - a.volume24hUsd);
    const liquidityUsd = venues.reduce((sum, venue) => sum + venue.liquidityUsd, 0);
    const volume24hUsd = venues.reduce((sum, venue) => sum + venue.volume24hUsd, 0);
    if (liquidityUsd < options.policy.minimumLiquidityUsd || volume24hUsd < options.policy.minimumVolume24hUsd) return [];
    const kind = lead.marketId ? "venue" as const : "candidate" as const;
    const v3Primary = venues.find((venue) => venue.protocol === "V3" && venue.liquidityUsd >= options.policy.incumbentLiquidityUsd);
    const attachableVenue = venues.find((venue) => venue.protocol === "V2" && venue.autoAttachable);
    const primary = kind === "venue" ? attachableVenue ?? venues[0] : v3Primary ?? venues[0];
    if (!primary) return [];
    const executionReady = kind === "venue" ? primary.protocol === "V2" : primary.protocol === "V3";
    return [{
      id: discoveryId(chain, lead.symbol, lead.token),
      kind,
      marketId: lead.marketId,
      chain,
      name: lead.name,
      symbol: lead.symbol,
      token: lead.token,
      pool: primary.pool,
      protocol: primary.protocol,
      feePips: primary.feePips,
      liquidityUsd,
      volume24hUsd,
      poolAgeDays: primary.poolAgeDays,
      sourceUrl: primary.sourceUrl,
      dexId: primary.dexId,
      executionReady,
      executionNote: executionReady
        ? undefined
        : kind === "venue"
          ? "This venue needs additional pool-key support before it can be attached to the tracked market."
          : "Research must identify a supported V3 primary pool before this lead can enter the executable catalog.",
      venues,
    }];
  })
    .sort((a, b) => b.volume24hUsd - a.volume24hUsd || b.liquidityUsd - a.liquidityUsd)
    .slice(0, 12);
}

async function getJson(url: string): Promise<GeckoPoolsPayload | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Wizzy-Curator/1" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return await response.json() as GeckoPoolsPayload;
  } catch {
    return null;
  }
}

export async function discoverCuratorCandidates(observedAt = new Date().toISOString()): Promise<CuratorDiscovery[]> {
  const config = getCuratorConfig();
  const catalog = getMarketCatalog();
  const results = await Promise.all(NETWORKS.map(async (chain) => {
    const chainMarkets = catalog.chains.find((entry) => entry.slug === chain)?.markets ?? [];
    const chainCandidates = config.candidates.filter((candidate) => candidate.chain === chain);
    const existingTokens = new Set(chainCandidates.map((candidate) => candidate.token.toLowerCase()));
    const trackedMarkets = new Map(chainMarkets.map((market) => [market.token.toLowerCase(), market.id]));
    const existingPools = new Set([
      ...chainMarkets.map((market) => market.pool.toLowerCase()),
      ...chainMarkets.flatMap((market) => market.liquidityVenues.map((venue) => ("pool" in venue ? venue.pool : venue.poolId).toLowerCase())),
      ...chainCandidates.map((candidate) => candidate.pool.toLowerCase()),
      ...chainCandidates.flatMap((candidate) => candidate.chain === "solana"
        ? []
        : candidate.liquidityVenues?.map((venue) => ("pool" in venue ? venue.pool : venue.poolId).toLowerCase()) ?? []),
    ]);
    const root = `https://api.geckoterminal.com/api/v2/networks/${chain}`;
    const payloads = await Promise.all([
      getJson(`${root}/trending_pools?page=1&include=base_token%2Cquote_token%2Cdex`),
      getJson(`${root}/pools?page=1&include=base_token%2Cquote_token%2Cdex&sort=h24_volume_usd_desc`),
    ]);
    return extractCuratorDiscoveries(payloads.filter((payload): payload is GeckoPoolsPayload => payload !== null), chain, {
      policy: config.policy,
      existingTokens,
      existingPools,
      trackedMarkets,
      observedAt,
    });
  }));
  return results.flat();
}
