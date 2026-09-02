import { createRequire } from "node:module";

type HostedPortfolioSurface = {
  getMarketCatalog: () => unknown;
  getSolanaMarketCatalog: () => unknown;
  fetchMarketStats: () => Promise<unknown>;
  selectBestMarketVenue: (chain: "base" | "robinhood", marketId: string) => Promise<{
    methodology: "venue-quality-v1";
    selectedKey: "PRIMARY" | "V2" | "V4";
    selectedProtocol: "V2" | "V3" | "V4" | "AERODROME_SLIPSTREAM";
    selectedPoolReference: `0x${string}`;
    switched: boolean;
    confidence: "high" | "guarded" | "fallback";
    decisionReasons: string[];
  }>;
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
  planAllocation: (input: {
    owner: string;
    chain: "base" | "robinhood";
    amountWei: bigint;
    marketId: string;
    protocol?: "V2" | "V3" | "V4";
  }) => Promise<unknown>;
  planPositionAction: (input: {
    owner: string;
    chain: "base" | "robinhood";
    tokenId: bigint;
    action: "collect" | "compound" | "increase" | "decrease" | "rebalance" | "withdraw";
    amountWei?: bigint;
    percent?: number;
    protocol?: "V2" | "V3" | "V4";
    venue?: "uniswap-v3" | "aerodrome-slipstream";
    positionManager?: string;
    rangePreset?: "focused" | "balanced" | "wide";
    tickLower?: number;
    tickUpper?: number;
    settle?: "eth" | "tokens";
  }) => Promise<unknown>;
  quoteBaseToRobinhoodEth: (input: { owner: string; amountInWei: bigint }) => Promise<unknown>;
  quoteEthToRobinhood: (input: { owner: string; amountInWei: bigint; originChainId: number }) => Promise<unknown>;
  ETH_FUNDING_CHAINS: readonly { id: number; label: string }[];
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
export const selectBestMarketVenue = hosted.selectBestMarketVenue;
export const fetchRecentPoolActivity = hosted.fetchRecentPoolActivity;
export const mergePoolActivityItems = hosted.mergePoolActivityItems;
export const fetchSolanaMarketStats = hosted.fetchSolanaMarketStats;
export const planAllocation = hosted.planAllocation;
export const planPositionAction = hosted.planPositionAction;
export const quoteBaseToRobinhoodEth = hosted.quoteBaseToRobinhoodEth;
export const quoteEthToRobinhood = hosted.quoteEthToRobinhood;
export const ETH_FUNDING_CHAINS = hosted.ETH_FUNDING_CHAINS;
export const relayIntentStatus = hosted.relayIntentStatus;
