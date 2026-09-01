import { getAddress, isAddress } from "viem";
import { addressesFor, type ChainSlug } from "../chains.js";
import { getMarketCatalog } from "../markets/catalog.js";
import { getCuratorConfig, type CuratorPolicy } from "./config.js";

type GeckoRelationship = { data: { id: string } };

type GeckoPool = {
  attributes: {
    address?: string;
    name?: string;
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
  chain: ChainSlug;
  name: string;
  symbol: string;
  token: `0x${string}`;
  pool: `0x${string}`;
  protocol: "V3";
  feePips: number;
  liquidityUsd: number;
  volume24hUsd: number;
  poolAgeDays: number;
  sourceUrl: string;
  dexId: string;
};

type DiscoveryOptions = {
  policy: CuratorPolicy;
  existingTokens: ReadonlySet<string>;
  existingPools: ReadonlySet<string>;
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
  const expectedDex = `uniswap-v3-${chain}`;
  const observedAt = Date.parse(options.observedAt);
  const discoveries = new Map<string, CuratorDiscovery>();

  for (const pool of payloads.flatMap((payload) => payload.data ?? [])) {
    const poolAddress = pool.attributes.address;
    if (!poolAddress || !isAddress(poolAddress) || pool.relationships.dex.data.id !== expectedDex) continue;
    const baseAddress = addressFromRelationship(pool.relationships.base_token.data.id);
    const quoteAddress = addressFromRelationship(pool.relationships.quote_token.data.id);
    if (!baseAddress || !quoteAddress) continue;
    const tokenAddress = baseAddress.toLowerCase() === weth
      ? quoteAddress
      : quoteAddress.toLowerCase() === weth
        ? baseAddress
        : null;
    if (!tokenAddress || tokenAddress.toLowerCase() === weth) continue;
    const normalizedPool = getAddress(poolAddress);
    if (options.existingTokens.has(tokenAddress.toLowerCase()) || options.existingPools.has(normalizedPool.toLowerCase())) continue;

    const liquidityUsd = numeric(pool.attributes.reserve_in_usd);
    const volume24hUsd = numeric(pool.attributes.volume_usd?.h24);
    const createdAt = pool.attributes.pool_created_at ? Date.parse(pool.attributes.pool_created_at) : Number.NaN;
    const poolAgeDays = Number.isFinite(createdAt) && Number.isFinite(observedAt)
      ? Math.max(0, (observedAt - createdAt) / 86_400_000)
      : null;
    const feePips = feePipsFromName(pool.attributes.name ?? "");
    if (liquidityUsd === null || liquidityUsd < options.policy.minimumLiquidityUsd) continue;
    if (volume24hUsd === null || volume24hUsd < options.policy.minimumVolume24hUsd) continue;
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

    const discovery: CuratorDiscovery = {
      id: discoveryId(chain, symbol, tokenAddress),
      chain,
      name,
      symbol,
      token: getAddress(tokenAddress),
      pool: normalizedPool,
      protocol: "V3",
      feePips,
      liquidityUsd,
      volume24hUsd,
      poolAgeDays,
      sourceUrl: `https://www.geckoterminal.com/${chain}/pools/${normalizedPool.toLowerCase()}`,
      dexId: expectedDex,
    };
    const prior = discoveries.get(discovery.token.toLowerCase());
    if (!prior || discovery.liquidityUsd > prior.liquidityUsd) discoveries.set(discovery.token.toLowerCase(), discovery);
  }

  return [...discoveries.values()]
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
  const existingTokens = new Set([
    ...catalog.chains.flatMap((chain) => chain.markets.map((market) => market.token.toLowerCase())),
    ...config.candidates.filter((candidate) => candidate.chain !== "solana").map((candidate) => candidate.token.toLowerCase()),
  ]);
  const existingPools = new Set([
    ...catalog.chains.flatMap((chain) => chain.markets.map((market) => market.pool.toLowerCase())),
    ...config.candidates.filter((candidate) => candidate.chain !== "solana").map((candidate) => candidate.pool.toLowerCase()),
  ]);
  const results = await Promise.all(NETWORKS.map(async (chain) => {
    const root = `https://api.geckoterminal.com/api/v2/networks/${chain}`;
    const payloads = await Promise.all([
      getJson(`${root}/trending_pools?page=1&include=base_token%2Cquote_token%2Cdex`),
      getJson(`${root}/pools?page=1&include=base_token%2Cquote_token%2Cdex&sort=h24_volume_usd_desc`),
    ]);
    return extractCuratorDiscoveries(payloads.filter((payload): payload is GeckoPoolsPayload => payload !== null), chain, {
      policy: config.policy,
      existingTokens,
      existingPools,
      observedAt,
    });
  }));
  return results.flat();
}
