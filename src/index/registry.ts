import {
  getAddress,
  hexToString,
  stringToHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { addressesFor, chainOf } from "../chains.js";
import { loadEnv } from "../config/env.js";
import { getCuratorConfig } from "../curator/config.js";
import { makePublicClient } from "../signer/broadcast.js";
import {
  chainCatalog,
  getMarketCatalog,
  type CuratedMarket,
  type MarketCatalog,
} from "../markets/catalog.js";
import { getRobinhoodIndexBreadthPolicy, type RobinhoodIndexBreadthPolicy } from "../portfolio/index-selection.js";

export const unaIndexRegistryAbi = [
  {
    type: "function",
    name: "publish",
    stateMutability: "nonpayable",
    inputs: [
      { name: "expectedVersion", type: "uint64" },
      {
        name: "nextMarkets",
        type: "tuple[]",
        components: [
          { name: "id", type: "bytes32" },
          { name: "token", type: "address" },
          { name: "pool", type: "address" },
          { name: "weightBps", type: "uint16" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "rangeWidthBps", type: "uint16" },
        ],
      },
      { name: "nextEvidenceHash", type: "bytes32" },
      { name: "nextEvidenceURI", type: "string" },
    ],
    outputs: [],
  },
  { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "updatedAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "evidenceHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "evidenceURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "curator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "replacementOf", stateMutability: "view", inputs: [{ name: "fromMarketId", type: "bytes32" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "FACTORY", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "QUOTE_TOKEN", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "pause",
    stateMutability: "nonpayable",
    inputs: [{ name: "reasonHash", type: "bytes32" }],
    outputs: [],
  },
  { type: "function", name: "unpause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "getMarkets",
    stateMutability: "view",
    inputs: [],
    outputs: [{
      type: "tuple[]",
      components: [
        { name: "id", type: "bytes32" },
        { name: "token", type: "address" },
        { name: "pool", type: "address" },
        { name: "weightBps", type: "uint16" },
        { name: "fee", type: "uint24" },
        { name: "tickSpacing", type: "int24" },
        { name: "rangeWidthBps", type: "uint16" },
      ],
    }],
  },
] as const;

export type RegistryMarket = {
  id: string;
  token: Address;
  pool: Address;
  weightBps: number;
  fee: number;
  tickSpacing: number;
  rangeWidthBps: number;
};

export type IndexRegistrySnapshot = {
  address: Address;
  blockNumber: bigint;
  version: number;
  updatedAt: number;
  paused: boolean;
  evidenceHash: Hex;
  evidenceURI: string;
  factory: Address;
  quoteToken: Address;
  markets: RegistryMarket[];
  replacements: Array<{ fromMarketId: string; toMarketId: string }>;
};

export type RobinhoodIndexState = {
  source: "catalog" | "onchain";
  policy: RobinhoodIndexBreadthPolicy;
  catalog: MarketCatalog;
  markets: CuratedMarket[];
  registry: null | Omit<IndexRegistrySnapshot, "markets" | "blockNumber"> & { blockNumber: string };
};

type RawMarket = Record<string, unknown> & readonly unknown[];

export async function readIndexRegistry(
  client: PublicClient,
  address: Address,
): Promise<IndexRegistrySnapshot> {
  const blockNumber = await client.getBlockNumber();
  const read = (functionName: "version" | "updatedAt" | "paused" | "evidenceHash" | "evidenceURI" | "FACTORY" | "QUOTE_TOKEN" | "getMarkets") => client.readContract({
    address,
    abi: unaIndexRegistryAbi,
    functionName,
    blockNumber,
  } as never) as Promise<unknown>;
  const [version, updatedAt, paused, evidenceHash, evidenceURI, factory, quoteToken, rawMarkets] = await Promise.all([
    read("version"),
    read("updatedAt"),
    read("paused"),
    read("evidenceHash"),
    read("evidenceURI"),
    read("FACTORY"),
    read("QUOTE_TOKEN"),
    read("getMarkets"),
  ]);
  const markets = (rawMarkets as RawMarket[]).map(parseMarket);
  const replacementRows = await Promise.all([...registryMetadata().keys()].map(async (fromMarketId) => {
    const toMarketIdHex = await client.readContract({
      address,
      abi: unaIndexRegistryAbi,
      functionName: "replacementOf",
      args: [stringToHex(fromMarketId, { size: 32 })],
      blockNumber,
    });
    const toMarketId = hexToString(toMarketIdHex).replace(/\0+$/g, "");
    return toMarketId ? { fromMarketId, toMarketId } : null;
  }));
  return {
    address: getAddress(address),
    blockNumber,
    version: safeNumber(version, "version"),
    updatedAt: safeNumber(updatedAt, "updatedAt"),
    paused: Boolean(paused),
    evidenceHash: evidenceHash as Hex,
    evidenceURI: String(evidenceURI),
    factory: getAddress(String(factory)),
    quoteToken: getAddress(String(quoteToken)),
    markets,
    replacements: replacementRows.filter((row): row is NonNullable<typeof row> => row !== null),
  };
}

export function resolveRegistryMarkets(snapshot: IndexRegistrySnapshot): CuratedMarket[] {
  if (snapshot.paused) throw new Error("The onchain Una index is paused");
  if (snapshot.version <= 0 || snapshot.markets.length === 0) throw new Error("The onchain Una index is not initialized");
  const expected = addressesFor("robinhood");
  if (snapshot.factory.toLowerCase() !== expected.factory.toLowerCase()) throw new Error("The Una registry uses an unexpected factory");
  if (snapshot.quoteToken.toLowerCase() !== expected.weth.toLowerCase()) throw new Error("The Una registry uses an unexpected quote token");
  const known = registryMetadata();
  const ids = new Set<string>();
  const markets = snapshot.markets.map((market) => {
    if (ids.has(market.id)) throw new Error(`The onchain Una index repeats ${market.id}`);
    ids.add(market.id);
    const metadata = known.get(market.id);
    if (!metadata) throw new Error(`The onchain Una index contains unknown market ${market.id}`);
    if (metadata.token.toLowerCase() !== market.token.toLowerCase() || metadata.pool.toLowerCase() !== market.pool.toLowerCase()) {
      throw new Error(`The onchain Una index conflicts with reviewed metadata for ${market.id}`);
    }
    return {
      ...metadata,
      protocol: "V3" as const,
      status: "active" as const,
      weightBps: market.weightBps,
      fee: market.fee,
      tickSpacing: market.tickSpacing,
      rangeWidthPct: market.rangeWidthBps / 100,
    };
  });
  const total = markets.reduce((sum, market) => sum + market.weightBps, 0);
  if (total !== 10_000) throw new Error(`The onchain Una index weights total ${total} bps`);
  return markets;
}

export async function getRobinhoodIndexState(): Promise<RobinhoodIndexState> {
  const env = loadEnv();
  if (!env.indexRegistryAddress) {
    const markets = chainCatalog("robinhood").markets.filter((market) => market.status === "active");
    return {
      source: "catalog",
      policy: getRobinhoodIndexBreadthPolicy(markets),
      catalog: getMarketCatalog(),
      markets,
      registry: null,
    };
  }
  const chain = chainOf("robinhood");
  const client = makePublicClient(env.rpcByChain.robinhood, chain.viem);
  const snapshot = await readIndexRegistry(client, env.indexRegistryAddress);
  const markets = resolveRegistryMarkets(snapshot);
  return {
    source: "onchain",
    policy: getRobinhoodIndexBreadthPolicy(markets),
    catalog: catalogWithRegistryMarkets(markets, snapshot.version, snapshot.updatedAt, snapshot.replacements),
    markets,
    registry: {
      address: snapshot.address,
      blockNumber: snapshot.blockNumber.toString(),
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
      paused: snapshot.paused,
      evidenceHash: snapshot.evidenceHash,
      evidenceURI: snapshot.evidenceURI,
      factory: snapshot.factory,
      quoteToken: snapshot.quoteToken,
      replacements: snapshot.replacements,
    },
  };
}

export function catalogWithRegistryMarkets(
  markets: CuratedMarket[],
  version: number,
  updatedAt: number,
  replacements: IndexRegistrySnapshot["replacements"],
): MarketCatalog {
  const byId = new Map(markets.map((market) => [market.id, market]));
  const catalog = getMarketCatalog();
  const known = registryMetadata();
  const migrations = replacements
    .filter((replacement) => byId.has(replacement.toMarketId) && known.has(replacement.fromMarketId))
    .map((replacement) => ({
      id: `registry-${version}-${replacement.fromMarketId}-to-${replacement.toMarketId}`,
      chain: "robinhood" as const,
      fromMarketId: replacement.fromMarketId,
      toMarketId: replacement.toMarketId,
      effectiveAt: new Date(updatedAt * 1_000).toISOString().slice(0, 10),
    }));
  return {
    ...catalog,
    version,
    updatedAt: new Date(updatedAt * 1_000).toISOString().slice(0, 10),
    migrations: [...catalog.migrations, ...migrations],
    chains: catalog.chains.map((chain) => chain.slug !== "robinhood" ? chain : {
      ...chain,
      markets: [...known.values()].map((market) => byId.get(market.id) ?? {
          ...market,
          status: "paused" as const,
        }),
    }) as MarketCatalog["chains"],
  };
}

function registryMetadata(): Map<string, CuratedMarket> {
  const chain = chainCatalog("robinhood");
  const known = new Map(chain.markets.map((market) => [market.id, market]));
  const palette = ["#5ef0b6", "#f4c851", "#8ba8ff", "#ff8a62", "#d39aff", "#ff6f83"];
  for (const candidate of getCuratorConfig().candidates.filter((row) => row.chain === "robinhood")) {
    if (known.has(candidate.id)) continue;
    const colorIndex = [...candidate.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % palette.length;
    known.set(candidate.id, {
      id: candidate.id,
      name: candidate.name,
      symbol: candidate.symbol,
      token: candidate.token,
      tokenDecimals: 18,
      quoteToken: chain.markets[0]!.quoteToken,
      quoteSymbol: chain.markets[0]!.quoteSymbol,
      quoteDecimals: chain.markets[0]!.quoteDecimals,
      protocol: "V3",
      pool: candidate.pool,
      fee: candidate.feePips,
      tickSpacing: 1,
      rangeWidthPct: 1,
      weightBps: 1,
      status: "watch",
      risk: candidate.risk,
      color: palette[colorIndex]!,
      liquidityVenues: [],
    });
  }
  return known;
}

function parseMarket(raw: RawMarket): RegistryMarket {
  const value = raw as unknown as Record<string, unknown> & { [index: number]: unknown };
  const idHex = String(value.id ?? value[0]) as Hex;
  return {
    id: hexToString(idHex).replace(/\0+$/g, ""),
    token: getAddress(String(value.token ?? value[1])),
    pool: getAddress(String(value.pool ?? value[2])),
    weightBps: safeNumber(value.weightBps ?? value[3], "weightBps"),
    fee: safeNumber(value.fee ?? value[4], "fee"),
    tickSpacing: safeNumber(value.tickSpacing ?? value[5], "tickSpacing"),
    rangeWidthBps: safeNumber(value.rangeWidthBps ?? value[6], "rangeWidthBps"),
  };
}

function safeNumber(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`Invalid onchain ${label}`);
  return number;
}
