import { createRequire } from "node:module";

type PoolSnapshotLike = {
  pools: Array<{ chain: "base" | "robinhood"; volume24hUsd: number } & Record<string, unknown>>;
  asOf: string;
  scanned: number;
  excluded: number;
  degraded: string[];
};

type HostedPortfolioSurface = {
  getMarketCatalog: () => unknown;
  getSolanaMarketCatalog: () => unknown;
  fetchMarketStats: () => Promise<unknown>;
  fetchCuratedPools: () => Promise<PoolSnapshotLike>;
  mergeSnapshots: (previous: PoolSnapshotLike | undefined, next: PoolSnapshotLike) => PoolSnapshotLike;
  catalogFallbackSnapshot: () => PoolSnapshotLike;
  fetchRecentPoolActivity: () => Promise<{
    items: Array<{
      id: string;
      kind: "added" | "removed";
      marketId: string;
      symbol: string;
      pair: string;
      wethAmount: string | null;
      transactionHash: `0x${string}`;
      transactionUrl: string;
      blockNumber: string;
    }>;
    asOfBlock: string;
    scannedBlocks: number;
    rpcRequests: 2;
  }>;
  mergePoolActivityItems: <T extends { id: string; blockNumber: string }>(
    previous: readonly T[],
    fresh: readonly T[],
    limit?: number,
  ) => T[];
  fetchSolanaMarketStats: () => Promise<unknown>;
  planPositionAction: (input: {
    owner: string;
    chain: "base" | "robinhood";
    tokenId: bigint;
    action: "collect" | "decrease" | "withdraw";
    percent?: number;
    protocol?: "V2" | "V3" | "V4";
    venue?: "uniswap-v3" | "aerodrome-slipstream";
    positionManager?: string;
  }) => Promise<unknown>;
  quoteRelaySwap: (input: {
    owner: string;
    originChainId: number;
    destinationChainId: number;
    originCurrency: string;
    destinationCurrency: string;
    amountWei: bigint;
  }) => Promise<unknown>;
  RELAY_CHAINS: readonly { id: number; label: string; slug: string }[];
  relayIntentStatus: (requestId: string) => Promise<unknown>;
};

function loadHostedPortfolio(): HostedPortfolioSurface {
  const require = createRequire(import.meta.url);
  try {
    return require("../../vendor/hosted-cjs/index.cjs") as HostedPortfolioSurface;
  } catch {
    return require("unabot-hosted-cjs") as HostedPortfolioSurface;
  }
}

const hosted = loadHostedPortfolio();

export const getMarketCatalog = hosted.getMarketCatalog;
export const getSolanaMarketCatalog = hosted.getSolanaMarketCatalog;
export const fetchMarketStats = hosted.fetchMarketStats;
export const fetchCuratedPools = hosted.fetchCuratedPools;
export const mergePoolSnapshots = hosted.mergeSnapshots;
export const catalogFallbackSnapshot = hosted.catalogFallbackSnapshot;
export const fetchRecentPoolActivity = hosted.fetchRecentPoolActivity;
export const mergePoolActivityItems = hosted.mergePoolActivityItems;
export const fetchSolanaMarketStats = hosted.fetchSolanaMarketStats;
export const planPositionAction = hosted.planPositionAction;
export const quoteRelaySwap = hosted.quoteRelaySwap;
export const RELAY_CHAINS = hosted.RELAY_CHAINS;
export const relayIntentStatus = hosted.relayIntentStatus;
