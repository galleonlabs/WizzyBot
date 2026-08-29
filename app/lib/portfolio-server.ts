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
  planPositionAction: (input: {
    owner: string;
    chain: "base" | "robinhood";
    tokenId: bigint;
    action: "compound" | "withdraw";
  }) => Promise<unknown>;
  quoteBaseToRobinhoodEth: (input: { owner: string; amountInWei: bigint }) => Promise<unknown>;
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
export const planPositionAction = hosted.planPositionAction;
export const quoteBaseToRobinhoodEth = hosted.quoteBaseToRobinhoodEth;
export const relayIntentStatus = hosted.relayIntentStatus;
