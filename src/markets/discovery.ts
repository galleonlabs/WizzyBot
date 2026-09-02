import { getAddress, isAddress, type Address } from "viem";
import { addressesFor, viemChainFor, type ChainSlug } from "../chains.js";
import { poolAbi } from "../chain/abi.js";
import { slipstreamPoolAbi } from "../aerodrome/abi.js";
import { loadEnv } from "../config/env.js";
import { makePublicClient } from "../signer/broadcast.js";
import { getMarketCatalog, type CuratedMarket } from "./catalog.js";

/**
 * Broad meme-pool discovery with deterministic curation. The reviewed catalog
 * stays the trusted layer; discovery widens the menu to every ETH-quoted meme
 * pool on the venues Wizzy can deep-link into, minus scams and dust.
 */

export type PoolVenue = "uniswap-v3" | "uniswap-v2" | "uniswap-v4" | "aerodrome-slipstream";

export type PoolFlag =
  | "reviewed"
  | "new"
  | "thin"
  | "quiet"
  | "unchecked"
  | "unverified"
  | "mintable"
  | "pausable"
  | "blacklist"
  | "hidden-owner"
  | "proxy"
  | "tax";

export type CuratedPool = {
  id: string;
  chain: ChainSlug;
  chainId: number;
  venue: PoolVenue;
  venueLabel: string;
  pool: string;
  token: { address: string; symbol: string; name: string; imageUrl: string | null };
  quote: { address: string; symbol: string };
  fee: number | null;
  tickSpacing: number | null;
  priceUsd: number | null;
  priceChange24h: number | null;
  liquidityUsd: number;
  volume24hUsd: number;
  txns24h: number | null;
  feeApr24hPct: number | null;
  createdAt: string | null;
  ageDays: number | null;
  reviewed: boolean;
  marketId?: string;
  flags: PoolFlag[];
  sourceUrl: string | null;
};

export type PoolsSnapshot = {
  pools: CuratedPool[];
  asOf: string;
  scanned: number;
  excluded: number;
  degraded: string[];
};

/** Normalised aggregator row before curation. */
export type RawPool = {
  chain: ChainSlug;
  dex: string;
  pool: string;
  name: string;
  base: RawToken;
  quote: RawToken;
  priceUsdBase: number | null;
  priceUsdQuote: number | null;
  priceChange24h: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  txns24h: number | null;
  createdAt: string | null;
};

export type RawToken = { address: string; symbol: string; name: string; imageUrl: string | null };

export type SecurityReport = {
  honeypot: boolean;
  cannotSellAll: boolean;
  ownerChangeBalance: boolean;
  selfDestruct: boolean;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  openSource: boolean | null;
  mintable: boolean;
  pausable: boolean;
  blacklist: boolean;
  hiddenOwner: boolean;
  proxy: boolean;
};

export type CurationRules = {
  minLiquidityUsd: number;
  thinLiquidityUsd: number;
  quietVolumeUsd: number;
  newAgeDays: number;
  maxTaxPct: number;
};

export const DEFAULT_RULES: CurationRules = {
  minLiquidityUsd: 10_000,
  thinLiquidityUsd: 50_000,
  quietVolumeUsd: 1_000,
  newAgeDays: 3,
  maxTaxPct: 10,
};

const GECKO = "https://api.geckoterminal.com/api/v2";
const GOPLUS = "https://api.gopluslabs.io/api/v1/token_security";
const NETWORKS: Record<ChainSlug, string> = { base: "base", robinhood: "robinhood" };
const REQUEST_GAP_MS = 1_500;
const RATE_LIMIT_BACKOFF_MS = 20_000;
const MAX_RATE_LIMIT_WAITS = 3;
const FETCH_TIMEOUT_MS = 7_000;
const CHAIN_IDS: Record<ChainSlug, number> = { base: 8453, robinhood: 4663 };

const DEX_VENUES: Record<string, PoolVenue> = {
  "uniswap-v3-base": "uniswap-v3",
  "uniswap-v3-robinhood": "uniswap-v3",
  "uniswap-v2-base": "uniswap-v2",
  "uniswap-v2-robinhood": "uniswap-v2",
  "uniswap-v4-base": "uniswap-v4",
  "uniswap-v4-robinhood": "uniswap-v4",
  "aerodrome-slipstream": "aerodrome-slipstream",
  "aerodrome-slipstream-2": "aerodrome-slipstream",
  "aerodrome-slipstream-3": "aerodrome-slipstream",
};

const VENUE_LABELS: Record<PoolVenue, string> = {
  "uniswap-v3": "Uniswap V3",
  "uniswap-v2": "Uniswap V2",
  "uniswap-v4": "Uniswap V4",
  "aerodrome-slipstream": "Aerodrome Slipstream",
};

/** Sweeps per chain, in priority order. Kept small: GeckoTerminal allows ~30 requests a minute. */
const SWEEPS: Record<ChainSlug, string[]> = {
  base: [
    "dexes/uniswap-v3-base/pools?page=1&sort=h24_volume_usd_desc",
    "dexes/uniswap-v3-base/pools?page=2&sort=h24_volume_usd_desc",
    "dexes/aerodrome-slipstream/pools?page=1&sort=h24_volume_usd_desc",
    "dexes/uniswap-v2-base/pools?page=1&sort=h24_volume_usd_desc",
    "trending_pools?page=1",
    "new_pools?page=1",
  ],
  robinhood: [
    "dexes/uniswap-v3-robinhood/pools?page=1&sort=h24_volume_usd_desc",
    "dexes/uniswap-v3-robinhood/pools?page=2&sort=h24_volume_usd_desc",
    "dexes/uniswap-v2-robinhood/pools?page=1&sort=h24_volume_usd_desc",
    "trending_pools?page=1",
    "new_pools?page=1",
  ],
};

/** Not memes: stables, majors, liquid staking, and tokenised stocks. Symbols are upper-cased before matching. */
const NOT_MEME_SYMBOLS = new Set([
  "WETH", "ETH", "USDC", "USDBC", "USDT", "USDG", "DAI", "EURC", "USDS", "GHO", "USDE", "SUSDE", "PYUSD",
  "CBBTC", "WBTC", "TBTC", "LBTC", "CBETH", "WSTETH", "RETH", "WEETH", "EZETH", "WRSETH", "RSETH", "STETH", "SUPEROETHB",
  "AERO", "VIRTUAL", "ZRO", "LINK", "UNI", "AAVE", "COMP", "CRV", "MORPHO", "WELL", "EIGEN", "ENA",
  "NVDA", "SPY", "QQQ", "TSLA", "AAPL", "MSFT", "AMZN", "GOOGL", "GOOG", "META", "TTWO", "SPCX", "CRCL", "RDDT", "SGOV", "COIN",
  "HOOD", "PLTR", "AMD", "NFLX", "MSTR", "GME", "AMC", "OPEN", "IWM", "DIA", "GLD", "TLT", "VOO", "IBIT", "NVDX", "TSLX",
  "KUSD", "KCAD", "KJPY", "KILS", "KEUR", "KGBP",
]);

export function venueForDex(dex: string): PoolVenue | undefined {
  return DEX_VENUES[dex];
}

function isEthLike(token: RawToken, chain: ChainSlug): boolean {
  const weth = addressesFor(chain).weth.toLowerCase();
  const address = token.address.toLowerCase();
  const symbol = token.symbol.toUpperCase();
  return address === weth || (address === "0x0000000000000000000000000000000000000000" && (symbol === "ETH" || symbol === "WETH"));
}

export function feePipsFromName(name: string): number | null {
  const match = /(\d+(?:\.\d+)?)%\s*$/.exec(name.trim());
  if (!match) return null;
  const pips = Math.round(Number(match[1]) * 10_000);
  return Number.isFinite(pips) && pips > 0 ? pips : null;
}

export function ageDaysFrom(createdAt: string | null, now: number): number | null {
  if (!createdAt) return null;
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return null;
  return Math.max(0, (now - created) / 86_400_000);
}

export function feeApr(volume24hUsd: number, liquidityUsd: number, feePips: number | null): number | null {
  if (feePips === null || !(liquidityUsd > 0)) return null;
  return (volume24hUsd * (feePips / 1_000_000) * 365 * 100) / liquidityUsd;
}

/**
 * Pure curation: which pools make the menu, which flags they carry, why the
 * rest are dropped. Deterministic so the rules are unit-testable.
 */
export function curatePools(input: {
  raw: RawPool[];
  security: ReadonlyMap<string, SecurityReport>;
  securityChecked: ReadonlySet<ChainSlug>;
  catalog?: ReadonlyMap<string, CuratedMarket & { chain: ChainSlug }>;
  onchain?: ReadonlyMap<string, { fee?: number; tickSpacing?: number }>;
  rules?: CurationRules;
  now?: number;
}): { pools: CuratedPool[]; excluded: Array<{ pool: string; reason: string }> } {
  const rules = input.rules ?? DEFAULT_RULES;
  const now = input.now ?? Date.now();
  const pools: CuratedPool[] = [];
  const excluded: Array<{ pool: string; reason: string }> = [];
  const seen = new Set<string>();
  for (const row of input.raw) {
    const key = `${row.chain}:${row.pool.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const venue = venueForDex(row.dex);
    if (!venue) {
      excluded.push({ pool: key, reason: "venue" });
      continue;
    }
    const baseIsEth = isEthLike(row.base, row.chain);
    const quoteIsEth = isEthLike(row.quote, row.chain);
    if (baseIsEth === quoteIsEth) {
      excluded.push({ pool: key, reason: "not an ETH pair" });
      continue;
    }
    const meme = baseIsEth ? row.quote : row.base;
    const eth = baseIsEth ? row.base : row.quote;
    if (NOT_MEME_SYMBOLS.has(meme.symbol.toUpperCase())) {
      excluded.push({ pool: key, reason: "not a meme" });
      continue;
    }
    const catalogEntry = input.catalog?.get(key);
    const reviewed = Boolean(catalogEntry);
    const liquidityUsd = row.liquidityUsd ?? 0;
    const volume24hUsd = row.volume24hUsd ?? 0;
    if (!reviewed && liquidityUsd < rules.minLiquidityUsd) {
      excluded.push({ pool: key, reason: "liquidity" });
      continue;
    }
    const ageDays = ageDaysFrom(row.createdAt, now);
    if (!reviewed && volume24hUsd <= 0 && (ageDays ?? 0) > 7) {
      excluded.push({ pool: key, reason: "dead" });
      continue;
    }
    const flags: PoolFlag[] = [];
    const report = input.security.get(`${row.chain}:${meme.address.toLowerCase()}`);
    if (report) {
      const rug = report.honeypot || report.cannotSellAll || report.ownerChangeBalance || report.selfDestruct
        || (report.buyTaxPct ?? 0) > rules.maxTaxPct || (report.sellTaxPct ?? 0) > rules.maxTaxPct;
      if (rug && !reviewed) {
        excluded.push({ pool: key, reason: "security" });
        continue;
      }
      if (report.openSource === false) flags.push("unverified");
      if (report.mintable) flags.push("mintable");
      if (report.pausable) flags.push("pausable");
      if (report.blacklist) flags.push("blacklist");
      if (report.hiddenOwner) flags.push("hidden-owner");
      if (report.proxy) flags.push("proxy");
      if ((report.buyTaxPct ?? 0) > 0 || (report.sellTaxPct ?? 0) > 0) flags.push("tax");
    } else if (input.securityChecked.has(row.chain)) {
      // The chain was checked but this token is unknown to the scanner.
      flags.push("unchecked");
    }
    if (reviewed) flags.unshift("reviewed");
    if (ageDays !== null && ageDays < rules.newAgeDays) flags.push("new");
    if (liquidityUsd < rules.thinLiquidityUsd) flags.push("thin");
    if (volume24hUsd < rules.quietVolumeUsd) flags.push("quiet");
    const onchain = input.onchain?.get(key);
    const fee = catalogEntry?.protocol === "V3" ? catalogEntry.fee : onchain?.fee ?? (venue === "uniswap-v2" ? 3000 : feePipsFromName(row.name));
    const tickSpacing = catalogEntry?.tickSpacing ?? onchain?.tickSpacing ?? null;
    const priceUsd = baseIsEth ? row.priceUsdQuote : row.priceUsdBase;
    pools.push({
      id: key,
      chain: row.chain,
      chainId: CHAIN_IDS[row.chain],
      venue,
      venueLabel: VENUE_LABELS[venue],
      pool: row.pool,
      token: { address: meme.address, symbol: meme.symbol, name: meme.name, imageUrl: catalogEntry?.imageUrl ?? meme.imageUrl ?? null },
      quote: { address: eth.address, symbol: eth.symbol.toUpperCase() === "ETH" ? "ETH" : "WETH" },
      fee,
      tickSpacing,
      priceUsd,
      priceChange24h: row.priceChange24h,
      liquidityUsd,
      volume24hUsd,
      txns24h: row.txns24h,
      feeApr24hPct: feeApr(volume24hUsd, liquidityUsd, fee),
      createdAt: row.createdAt,
      ageDays,
      reviewed,
      marketId: catalogEntry?.id,
      flags,
      sourceUrl: `https://www.geckoterminal.com/${NETWORKS[row.chain]}/pools/${row.pool.toLowerCase()}`,
    });
  }
  pools.sort((a, b) => b.volume24hUsd - a.volume24hUsd);
  return { pools, excluded };
}

type GeckoPool = {
  id: string;
  attributes: {
    address?: string;
    name?: string;
    base_token_price_usd?: string | null;
    quote_token_price_usd?: string | null;
    price_change_percentage?: { h24?: string | null };
    reserve_in_usd?: string | null;
    volume_usd?: { h24?: string | null };
    transactions?: { h24?: { buys?: number; sells?: number } };
    pool_created_at?: string | null;
  };
  relationships: {
    base_token: { data: { id: string } };
    quote_token: { data: { id: string } };
    dex: { data: { id: string } };
  };
};

type GeckoIncluded = {
  id: string;
  type: string;
  attributes: { address?: string; symbol?: string; name?: string; image_url?: string | null };
};

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeGeckoPools(chain: ChainSlug, payload: { data?: GeckoPool[]; included?: GeckoIncluded[] }): RawPool[] {
  const tokens = new Map((payload.included ?? []).filter((entry) => entry.type === "token").map((entry) => [entry.id, entry]));
  const rows: RawPool[] = [];
  for (const pool of payload.data ?? []) {
    const address = pool.attributes.address;
    if (!address) continue;
    const base = tokenFrom(tokens.get(pool.relationships.base_token.data.id), pool.relationships.base_token.data.id);
    const quote = tokenFrom(tokens.get(pool.relationships.quote_token.data.id), pool.relationships.quote_token.data.id);
    if (!base || !quote) continue;
    const transactions = pool.attributes.transactions?.h24;
    rows.push({
      chain,
      dex: pool.relationships.dex.data.id,
      pool: address,
      name: pool.attributes.name ?? `${base.symbol} / ${quote.symbol}`,
      base,
      quote,
      priceUsdBase: finite(pool.attributes.base_token_price_usd),
      priceUsdQuote: finite(pool.attributes.quote_token_price_usd),
      priceChange24h: finite(pool.attributes.price_change_percentage?.h24),
      liquidityUsd: finite(pool.attributes.reserve_in_usd),
      volume24hUsd: finite(pool.attributes.volume_usd?.h24),
      txns24h: transactions ? (transactions.buys ?? 0) + (transactions.sells ?? 0) : null,
      createdAt: pool.attributes.pool_created_at ?? null,
    });
  }
  return rows;
}

function tokenFrom(entry: GeckoIncluded | undefined, id: string): RawToken | null {
  const address = entry?.attributes.address ?? id.split("_")[1];
  if (!address) return null;
  return {
    address,
    symbol: entry?.attributes.symbol ?? "?",
    name: entry?.attributes.name ?? entry?.attributes.symbol ?? "?",
    imageUrl: entry?.attributes.image_url && !entry.attributes.image_url.includes("missing") ? entry.attributes.image_url : null,
  };
}

export function parseSecurityReport(value: unknown): SecurityReport | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const flag = (key: string) => record[key] === "1" || record[key] === 1 || record[key] === true;
  const pct = (key: string) => {
    const parsed = finite(record[key]);
    return parsed === null ? null : parsed <= 1 ? parsed * 100 : parsed;
  };
  return {
    honeypot: flag("is_honeypot"),
    cannotSellAll: flag("cannot_sell_all"),
    ownerChangeBalance: flag("owner_change_balance"),
    selfDestruct: flag("selfdestruct"),
    buyTaxPct: pct("buy_tax"),
    sellTaxPct: pct("sell_tax"),
    openSource: record.is_open_source === undefined ? null : flag("is_open_source"),
    mintable: flag("is_mintable"),
    pausable: flag("transfer_pausable"),
    blacklist: flag("is_blacklisted"),
    hiddenOwner: flag("hidden_owner"),
    proxy: flag("is_proxy"),
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function geckoGet(path: string): Promise<{ data?: GeckoPool[]; included?: GeckoIncluded[] } | "rate-limited"> {
  const response = await fetch(`${GECKO}/${path}${path.includes("?") ? "&" : "?"}include=base_token%2Cquote_token%2Cdex`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 429) return "rate-limited";
  if (!response.ok) throw new Error(`GeckoTerminal ${response.status}`);
  return response.json() as Promise<{ data?: GeckoPool[]; included?: GeckoIncluded[] }>;
}

async function fetchSecurity(addresses: string[]): Promise<Map<string, SecurityReport>> {
  const reports = new Map<string, SecurityReport>();
  for (let index = 0; index < addresses.length; index += 20) {
    const chunk = addresses.slice(index, index + 20);
    const response = await fetch(`${GOPLUS}/8453?contract_addresses=${chunk.join(",")}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`GoPlus ${response.status}`);
    const payload = await response.json() as { result?: Record<string, unknown> };
    for (const [address, report] of Object.entries(payload.result ?? {})) {
      const parsed = parseSecurityReport(report);
      if (parsed) reports.set(`base:${address.toLowerCase()}`, parsed);
    }
  }
  return reports;
}

async function readOnchain(rows: RawPool[]): Promise<Map<string, { fee?: number; tickSpacing?: number }>> {
  const env = loadEnv();
  const out = new Map<string, { fee?: number; tickSpacing?: number }>();
  for (const chain of ["base", "robinhood"] as const) {
    const client = makePublicClient(env.rpcByChain[chain], viemChainFor(chain), { retryCount: 1, timeoutMs: 6_000 });
    const targets = rows.filter((row) => row.chain === chain && isAddress(row.pool));
    await Promise.all(targets.map(async (row) => {
      const venue = venueForDex(row.dex);
      const key = `${chain}:${row.pool.toLowerCase()}`;
      try {
        if (venue === "uniswap-v3" && feePipsFromName(row.name) === null) {
          out.set(key, { fee: await client.readContract({ address: getAddress(row.pool), abi: poolAbi, functionName: "fee" }) });
        } else if (venue === "aerodrome-slipstream") {
          const [fee, tickSpacing] = await Promise.all([
            client.readContract({ address: getAddress(row.pool), abi: slipstreamPoolAbi, functionName: "fee" }),
            client.readContract({ address: getAddress(row.pool), abi: slipstreamPoolAbi, functionName: "tickSpacing" }),
          ]);
          out.set(key, { fee, tickSpacing });
        }
      } catch {
        // The deep link still works without the tier; Uniswap and Aerodrome ask for it.
      }
    }));
  }
  return out;
}

function catalogIndex(): Map<string, CuratedMarket & { chain: ChainSlug }> {
  const index = new Map<string, CuratedMarket & { chain: ChainSlug }>();
  for (const chain of getMarketCatalog().chains) {
    for (const market of chain.markets) {
      if (market.status === "active") index.set(`${chain.slug}:${market.pool.toLowerCase()}`, { ...market, chain: chain.slug });
    }
  }
  return index;
}

export async function fetchCuratedPools(): Promise<PoolsSnapshot> {
  const degraded: string[] = [];
  const raw: RawPool[] = [];
  const catalog = catalogIndex();
  let rateLimitWaits = 0;
  let exhausted = false;
  // One shared sweep per cache window. A 429 pauses the sweep and retries the
  // same page; only repeated limits leave a partial menu.
  const sweep = async (chain: ChainSlug, path: string): Promise<void> => {
    if (exhausted) return;
    const payload = await geckoGet(`networks/${NETWORKS[chain]}/${path}`);
    if (payload !== "rate-limited") {
      raw.push(...normalizeGeckoPools(chain, payload));
      await sleep(REQUEST_GAP_MS);
      return;
    }
    if (rateLimitWaits >= MAX_RATE_LIMIT_WAITS) {
      exhausted = true;
      degraded.push("GeckoTerminal rate limit reached; showing a partial sweep.");
      return;
    }
    rateLimitWaits += 1;
    await sleep(RATE_LIMIT_BACKOFF_MS);
    return sweep(chain, path);
  };
  for (const chain of ["base", "robinhood"] as const) {
    for (const path of SWEEPS[chain]) {
      try {
        await sweep(chain, path);
      } catch (error) {
        degraded.push(`GeckoTerminal ${chain} sweep failed: ${error instanceof Error ? error.message : "unknown"}`);
      }
    }
    // Reviewed markets always make the menu, even when the sweep missed them.
    const missing = [...catalog.values()].filter((market) => market.chain === chain && !raw.some((row) => row.chain === chain && row.pool.toLowerCase() === market.pool.toLowerCase()));
    if (missing.length) {
      try {
        await sweep(chain, `pools/multi/${missing.map((market) => market.pool.toLowerCase()).join(",")}`);
      } catch (error) {
        degraded.push(`Reviewed ${chain} markets could not be refreshed: ${error instanceof Error ? error.message : "unknown"}`);
      }
    }
  }
  if (!raw.length) throw new Error("Pool discovery returned nothing");

  const baseTokens = [...new Set(raw
    .filter((row) => row.chain === "base")
    .flatMap((row) => [row.base, row.quote])
    .filter((token) => !isEthLike(token, "base") && isAddress(token.address))
    .map((token) => token.address.toLowerCase()))];
  const securityChecked = new Set<ChainSlug>();
  let security = new Map<string, SecurityReport>();
  try {
    security = await fetchSecurity(baseTokens);
    securityChecked.add("base");
  } catch (error) {
    degraded.push(`Security checks unavailable: ${error instanceof Error ? error.message : "unknown"}`);
  }
  let onchain = new Map<string, { fee?: number; tickSpacing?: number }>();
  try {
    onchain = await readOnchain(raw);
  } catch {
    degraded.push("Pool fee tiers could not be read onchain.");
  }
  const { pools, excluded } = curatePools({ raw, security, securityChecked, catalog, onchain });
  return { pools, asOf: new Date().toISOString(), scanned: raw.length, excluded: excluded.length, degraded };
}

/**
 * When a sweep comes back degraded, keep the last good pools for any chain the
 * new sweep missed entirely, so a rate-limited refresh never empties the menu.
 */
export function mergeSnapshots(previous: PoolsSnapshot | undefined, next: PoolsSnapshot): PoolsSnapshot {
  if (!previous || !next.degraded.length) return next;
  const chains: ChainSlug[] = ["base", "robinhood"];
  const pools = [...next.pools];
  const carried: string[] = [];
  for (const chain of chains) {
    if (pools.some((pool) => pool.chain === chain)) continue;
    const kept = previous.pools.filter((pool) => pool.chain === chain);
    if (!kept.length) continue;
    pools.push(...kept);
    carried.push(chain);
  }
  pools.sort((a, b) => b.volume24hUsd - a.volume24hUsd);
  return {
    ...next,
    pools,
    degraded: carried.length ? [...next.degraded, `Kept the previous ${carried.join(" and ")} sweep from ${previous.asOf}.`] : next.degraded,
  };
}

/** Reviewed markets with no live stats: what the menu shows when every upstream is down. */
export function catalogFallbackSnapshot(now = Date.now()): PoolsSnapshot {
  const pools: CuratedPool[] = [];
  for (const chain of getMarketCatalog().chains) {
    for (const market of chain.markets) {
      if (market.status !== "active") continue;
      const venue: PoolVenue = market.protocol === "AERODROME_SLIPSTREAM" ? "aerodrome-slipstream" : "uniswap-v3";
      pools.push({
        id: `${chain.slug}:${market.pool.toLowerCase()}`,
        chain: chain.slug,
        chainId: CHAIN_IDS[chain.slug],
        venue,
        venueLabel: VENUE_LABELS[venue],
        pool: market.pool,
        token: { address: market.token, symbol: market.symbol, name: market.name, imageUrl: market.imageUrl ?? null },
        quote: { address: market.quoteToken, symbol: "WETH" },
        fee: market.protocol === "V3" ? market.fee : null,
        tickSpacing: market.tickSpacing,
        priceUsd: null,
        priceChange24h: null,
        liquidityUsd: 0,
        volume24hUsd: 0,
        txns24h: null,
        feeApr24hPct: null,
        createdAt: null,
        ageDays: null,
        reviewed: true,
        marketId: market.id,
        flags: ["reviewed"],
        sourceUrl: null,
      });
    }
  }
  return { pools, asOf: new Date(now).toISOString(), scanned: 0, excluded: 0, degraded: ["Live pool data is unavailable right now; showing reviewed markets only."] };
}
