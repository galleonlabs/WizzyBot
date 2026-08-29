import { getMarketCatalog } from "../markets/catalog.js";
import { getSolanaMarketCatalog } from "../markets/solana-catalog.js";
import { unpackMint } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { getCuratorConfig, type CuratorCandidate } from "./config.js";
import type { CuratorObservation } from "./policy.js";

type MarketDefinition = Pick<CuratorObservation, "marketId" | "chain" | "name" | "symbol" | "token" | "pool" | "protocol" | "incumbent" | "catalogStatus" | "risk" | "identity"> & {
  feePips: number;
};

type DexPair = {
  url?: string;
  priceUsd?: string;
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  marketCap?: number;
  fdv?: number;
  pairCreatedAt?: number;
  info?: { websites?: unknown[]; socials?: unknown[] };
};

type GoPlusToken = {
  is_open_source?: string;
  is_proxy?: string;
  is_mintable?: string;
  owner_change_balance?: string;
  hidden_owner?: string;
  selfdestruct?: string;
  external_call?: string;
  is_honeypot?: string;
  cannot_sell_all?: string;
  transfer_pausable?: string;
  malicious_address?: string;
  buy_tax?: string;
  sell_tax?: string;
  holder_count?: string;
  holders?: Array<{ percent?: string; is_contract?: number }>;
};

type MeteoraToken = {
  address: string;
  freeze_authority_disabled?: boolean;
  holders?: number;
  is_verified?: boolean;
  market_cap?: number;
  price?: number;
};

type MeteoraPool = {
  address: string;
  created_at?: number;
  current_price?: number;
  is_blacklisted?: boolean;
  token_x: MeteoraToken;
  token_y: MeteoraToken;
  tvl?: number;
  volume?: { "24h"?: number };
  fees?: { "24h"?: number };
};

type SolanaMintSecurity = {
  mintAuthorityDisabled: boolean;
  freezeAuthorityDisabled: boolean;
};

const solanaConnection = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");
const solanaMintSecurity = new Map<string, Promise<SolanaMintSecurity | null>>();

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function definitions(): MarketDefinition[] {
  const evm = getMarketCatalog().chains.flatMap((chain) => chain.markets.map((market): MarketDefinition => ({
    marketId: market.id,
    chain: chain.slug,
    name: market.name,
    symbol: market.symbol,
    token: market.token,
    pool: market.pool,
    protocol: market.protocol,
    feePips: market.fee,
    incumbent: market.status === "active",
    catalogStatus: market.status,
    risk: market.risk,
    identity: "reviewed",
  })));
  const solana = getSolanaMarketCatalog().markets.map((market): MarketDefinition => ({
    marketId: market.id,
    chain: "solana",
    name: market.name,
    symbol: market.symbol,
    token: market.token,
    pool: market.pool,
    protocol: market.protocol,
    feePips: market.feeBps * 100,
    incumbent: market.status === "active",
    catalogStatus: market.status,
    risk: market.risk,
    identity: "reviewed",
  }));
  const candidates = getCuratorConfig().candidates.map(candidateDefinition);
  return [...evm, ...solana, ...candidates];
}

function candidateDefinition(candidate: CuratorCandidate): MarketDefinition {
  return {
    marketId: candidate.id,
    chain: candidate.chain,
    name: candidate.name,
    symbol: candidate.symbol,
    token: candidate.token,
    pool: candidate.pool,
    protocol: candidate.protocol,
    feePips: candidate.feePips,
    incumbent: false,
    catalogStatus: "watch",
    risk: candidate.risk,
    identity: candidate.identity,
  };
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Una-Curator/1" }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

async function dexPair(chain: MarketDefinition["chain"], pool: string): Promise<DexPair | null> {
  const dexChain = chain === "robinhood" ? "robinhood" : chain;
  const payload = await getJson<{ pair?: DexPair; pairs?: DexPair[] }>(`https://api.dexscreener.com/latest/dex/pairs/${dexChain}/${pool}`);
  return payload?.pair ?? payload?.pairs?.[0] ?? null;
}

function getSolanaMintSecurity(token: string): Promise<SolanaMintSecurity | null> {
  const cached = solanaMintSecurity.get(token);
  if (cached) return cached;
  const request = (async () => {
    try {
      const address = new PublicKey(token);
      const account = await solanaConnection.getAccountInfo(address);
      if (!account) return null;
      const mint = unpackMint(address, account, account.owner);
      return { mintAuthorityDisabled: mint.mintAuthority === null, freezeAuthorityDisabled: mint.freezeAuthority === null };
    } catch {
      return null;
    }
  })();
  solanaMintSecurity.set(token, request);
  return request;
}

function evmSecurityFlags(token: GoPlusToken | null): string[] {
  if (!token) return [];
  const flags: string[] = [];
  const booleanRisks: Array<[keyof GoPlusToken, string]> = [
    ["is_honeypot", "honeypot"],
    ["cannot_sell_all", "sell restriction"],
    ["is_mintable", "mintable supply"],
    ["owner_change_balance", "owner can change balances"],
    ["hidden_owner", "hidden owner"],
    ["selfdestruct", "self-destruct capability"],
    ["transfer_pausable", "transfers can be paused"],
    ["malicious_address", "malicious address"],
  ];
  for (const [key, label] of booleanRisks) if (token[key] === "1") flags.push(label);
  if (token.is_open_source === "0") flags.push("contract source unavailable");
  const buyTax = numberOrNull(token.buy_tax);
  const sellTax = numberOrNull(token.sell_tax);
  if ((buyTax ?? 0) > 0.05 || (sellTax ?? 0) > 0.05) flags.push("token tax exceeds 5%");
  return flags;
}

async function collectEvm(definition: MarketDefinition, observedAt: string): Promise<CuratorObservation> {
  const chainId = definition.chain === "robinhood" ? 4663 : 8453;
  const [pair, securityPayload] = await Promise.all([
    dexPair(definition.chain, definition.pool),
    getJson<{ result?: Record<string, GoPlusToken> }>(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${definition.token}`),
  ]);
  const security = securityPayload?.result?.[definition.token.toLowerCase()] ?? null;
  const topExternallyOwnedHolder = security?.holders
    ?.filter((holder) => holder.is_contract !== 1)
    .map((holder) => numberOrNull(holder.percent))
    .filter((value): value is number => value !== null)
    .sort((a, b) => b - a)[0] ?? null;
  const liquidityUsd = numberOrNull(pair?.liquidity?.usd);
  const volume24hUsd = numberOrNull(pair?.volume?.h24);
  const fees24hUsd = volume24hUsd === null ? null : volume24hUsd * definition.feePips / 1_000_000;
  return {
    ...definition,
    liquidityUsd,
    volume24hUsd,
    fees24hUsd,
    feeAprPct: liquidityUsd && fees24hUsd !== null ? fees24hUsd * 365 * 100 / liquidityUsd : null,
    priceUsd: numberOrNull(pair?.priceUsd),
    priceChange24hPct: numberOrNull(pair?.priceChange?.h24),
    marketCapUsd: numberOrNull(pair?.marketCap ?? pair?.fdv),
    poolAgeDays: pair?.pairCreatedAt ? Math.max(0, (Date.parse(observedAt) - pair.pairCreatedAt) / 86_400_000) : null,
    holderCount: numberOrNull(security?.holder_count),
    topHolderPct: topExternallyOwnedHolder === null ? null : topExternallyOwnedHolder * 100,
    socialLinks: (pair?.info?.websites?.length ?? 0) + (pair?.info?.socials?.length ?? 0),
    securityAvailable: security !== null,
    securityFlags: evmSecurityFlags(security),
    sourceUrl: pair?.url ?? null,
    observedAt,
  };
}

async function collectSolana(definition: MarketDefinition, observedAt: string): Promise<CuratorObservation> {
  const [pool, pair, mintSecurity] = await Promise.all([
    getJson<MeteoraPool>(`https://dlmm.datapi.meteora.ag/pools/${definition.pool}`),
    dexPair("solana", definition.pool),
    getSolanaMintSecurity(definition.token),
  ]);
  const token = pool?.token_x.address === definition.token ? pool.token_x : pool?.token_y.address === definition.token ? pool.token_y : null;
  const securityFlags: string[] = [];
  if (pool?.is_blacklisted) securityFlags.push("Meteora blacklist");
  if (token?.is_verified === false) securityFlags.push("token is not verified by venue data");
  if (token?.freeze_authority_disabled === false) securityFlags.push("freeze authority is enabled");
  if (mintSecurity?.mintAuthorityDisabled === false) securityFlags.push("mint authority is enabled");
  if (mintSecurity?.freezeAuthorityDisabled === false && token?.freeze_authority_disabled !== false) securityFlags.push("freeze authority is enabled");
  const liquidityUsd = numberOrNull(pool?.tvl ?? pair?.liquidity?.usd);
  const volume24hUsd = numberOrNull(pool?.volume?.["24h"] ?? pair?.volume?.h24);
  const fees24hUsd = numberOrNull(pool?.fees?.["24h"] ?? (volume24hUsd === null ? null : volume24hUsd * definition.feePips / 1_000_000));
  return {
    ...definition,
    liquidityUsd,
    volume24hUsd,
    fees24hUsd,
    feeAprPct: liquidityUsd && fees24hUsd !== null ? fees24hUsd * 365 * 100 / liquidityUsd : null,
    priceUsd: numberOrNull(token?.price ?? pair?.priceUsd),
    priceChange24hPct: numberOrNull(pair?.priceChange?.h24),
    marketCapUsd: numberOrNull(token?.market_cap ?? pair?.marketCap ?? pair?.fdv),
    poolAgeDays: pool?.created_at ? Math.max(0, (Date.parse(observedAt) - pool.created_at) / 86_400_000) : null,
    holderCount: numberOrNull(token?.holders),
    topHolderPct: null,
    socialLinks: (pair?.info?.websites?.length ?? 0) + (pair?.info?.socials?.length ?? 0),
    securityAvailable: pool !== null && token !== null && mintSecurity !== null,
    securityFlags,
    sourceUrl: pair?.url ?? `https://app.meteora.ag/dlmm/${definition.pool}`,
    observedAt,
  };
}

export async function collectCuratorObservations(observedAt = new Date().toISOString()): Promise<CuratorObservation[]> {
  return Promise.all(definitions().map((definition) => definition.chain === "solana"
    ? collectSolana(definition, observedAt)
    : collectEvm(definition, observedAt)));
}
