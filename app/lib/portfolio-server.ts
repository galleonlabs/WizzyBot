import { createRequire } from "node:module";

type HostedPortfolioSurface = {
  getMarketCatalog: () => unknown;
  getSolanaMarketCatalog: () => unknown;
  fetchMarketStats: () => Promise<unknown>;
  fetchSolanaMarketStats: () => Promise<unknown>;
  planAllocation: (input: {
    owner: string;
    chain: "base" | "robinhood";
    amountWei: bigint;
    marketIds?: readonly string[];
  }) => Promise<unknown>;
  planDualChainAllocation: (input: {
    owner: string;
    totalAmountWei: bigint;
    robinhoodShareBps?: number;
    baseMarketIds?: readonly string[];
    robinhoodMarketIds?: readonly string[];
  }) => Promise<unknown>;
  planMemeIndex: (input: {
    owner: string;
    solanaOwner: string;
    totalAmountWei: bigint;
  }) => Promise<unknown>;
  planRobinhoodIndex: (input: {
    owner: string;
    totalAmountWei: bigint;
    originChainId?: number;
  }) => Promise<unknown>;
  getMemeIndexBreadthPolicy: () => unknown;
  getRobinhoodIndexBreadthPolicy: () => unknown;
  planPositionAction: (input: {
    owner: string;
    chain: "base" | "robinhood";
    tokenId: bigint;
    action: "compound" | "withdraw";
    venue?: "uniswap-v3" | "aerodrome-slipstream";
    positionManager?: string;
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
export const fetchSolanaMarketStats = hosted.fetchSolanaMarketStats;
export const planAllocation = hosted.planAllocation;
export const planDualChainAllocation = hosted.planDualChainAllocation;
export const planMemeIndex = hosted.planMemeIndex;
export const planRobinhoodIndex = hosted.planRobinhoodIndex;
export const getMemeIndexBreadthPolicy = hosted.getMemeIndexBreadthPolicy;
export const getRobinhoodIndexBreadthPolicy = hosted.getRobinhoodIndexBreadthPolicy;
export const planPositionAction = hosted.planPositionAction;
export const quoteBaseToRobinhoodEth = hosted.quoteBaseToRobinhoodEth;
export const quoteEthToRobinhood = hosted.quoteEthToRobinhood;
export const ETH_FUNDING_CHAINS = hosted.ETH_FUNDING_CHAINS;
export const relayIntentStatus = hosted.relayIntentStatus;
