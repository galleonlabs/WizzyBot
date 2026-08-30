import type { ChainSlug } from "./chains";
import type { WalletTransaction } from "./wallet-calls";

export type AllocationTarget = ChainSlug | "both";
export type MarketRisk = "established" | "emerging" | "experimental";
export type ProjectionConfidence = "illustrative" | "unstable" | "unavailable";

export type CuratedMarket = {
  id: string;
  name: string;
  symbol: string;
  token: `0x${string}`;
  quoteSymbol: string;
  protocol: "V3" | "AERODROME_SLIPSTREAM";
  aerodromeDeployment?: "legacy" | "min-unstake";
  pool: `0x${string}`;
  fee: number;
  rangeWidthPct: number;
  weightBps: number;
  status: "active" | "paused" | "watch";
  risk: MarketRisk;
  imageUrl?: string;
  color: string;
};

export type CuratedChain = {
  slug: ChainSlug;
  chainId: number;
  label: string;
  accent: string;
  minimumAllocationWei: string;
  markets: CuratedMarket[];
};

export type MarketCatalog = {
  version: number;
  updatedAt: string;
  fees: {
    allocateBps: number;
    withdrawBps: number;
    rebalanceBps: number;
    compoundBps: number;
  };
  migrations: Array<{
    id: string;
    chain: "robinhood";
    fromMarketId: string;
    toMarketId: string;
    effectiveAt: string;
  }>;
  chains: CuratedChain[];
};

export type MarketStats = {
  marketId: string;
  tokenImageUrl: string | null;
  feePips: number;
  priceUsd: number | null;
  priceChange24h: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  marketCapUsd: number | null;
  trailingFeeAprPct: number | null;
  dailyFeesPer1000Usd: number | null;
  projectedMonthlyFeesPer1000Usd: number | null;
  projectionConfidence: ProjectionConfidence;
  poolAgeDays: number | null;
  energy: number | null;
  sourceUrl: string | null;
  asOf: string;
};

export type MarketsPayload = {
  catalog: MarketCatalog;
  solana: SolanaChainCatalog;
  index: RobinhoodIndexBreadthPolicy;
  fundingChains: EthFundingChain[];
  stats: MarketStats[];
  source: string;
};

export type PoolActivityItem = {
  id: string;
  kind: "added" | "removed";
  marketId: string;
  symbol: string;
  pair: string;
  wethAmount: string | null;
  transactionHash: `0x${string}`;
  transactionUrl: string;
  blockNumber: string;
};

export type PoolActivityPayload = {
  state: "ready" | "unavailable";
  items: PoolActivityItem[];
  asOfBlock: string | null;
  scannedBlocks: number;
  rpcRequests: 2;
};

export type EthFundingChain = {
  id: number;
  label: string;
};

export type RobinhoodIndexBreadthTier = {
  minimumAmountWei: string;
  constituentCount: number;
  marketIds: string[];
};

export type RobinhoodIndexBreadthPolicy = {
  chain: "robinhood";
  breadthUnitWei: string;
  minimumAmountWei: string;
  maximumConstituents: number;
  tiers: RobinhoodIndexBreadthTier[];
  selectionRules: {
    minimumPoolAgeDays: number;
    minimumLiquidityUsd: number;
    quoteSymbol: "WETH";
    venue: "Uniswap v3";
  };
};

export type IndexBreadthTier = {
  minimumAmountWei: string;
  constituentCount: number;
  marketIds: Record<"base" | "robinhood" | "solana", string[]>;
};

export type MemeIndexBreadthPolicy = {
  breadthUnitWei: string;
  minimumAmountWei: string;
  maximumConstituents: number;
  chainSharesBps: Record<"base" | "robinhood" | "solana", number>;
  tiers: IndexBreadthTier[];
};

export type SolanaCuratedMarket = {
  id: string;
  name: string;
  symbol: string;
  token: string;
  quoteToken: string;
  quoteSymbol: "SOL";
  protocol: "Meteora DLMM";
  pool: string;
  feeBps: number;
  binStep: number;
  rangeDelta: number;
  weightBps: number;
  status: "active" | "paused" | "watch";
  risk: MarketRisk;
  color: string;
};

export type SolanaChainCatalog = {
  slug: "solana";
  chainId: 792703809;
  label: "Solana";
  accent: string;
  minimumAllocationLamports: string;
  gasReserveLamports: string;
  markets: SolanaCuratedMarket[];
};

export type AllocationMarketPlan = {
  marketId: string;
  symbol: string;
  pool: `0x${string}`;
  venue: "uniswap-v3" | "aerodrome-slipstream";
  positionManager: `0x${string}`;
  weightBps: number;
  budgetWei: string;
  swapInWei: string;
  quotedMemeOut: string;
  minimumMemeOut: string;
  mintWeth: string;
  mintMeme: string;
  tickLower: number;
  tickUpper: number;
  leftoverWeth: string;
  leftoverMeme: string;
};

export type AllocationPlan = {
  kind: "allocate";
  owner: `0x${string}`;
  chain: ChainSlug;
  chainId: number;
  amountWei: string;
  serviceFeeBps: number;
  serviceFeeWei: string;
  netAllocationWei: string;
  expectedConfirmations: 1;
  execution: "wallet_sendCalls";
  atomic: true;
  createdAt: string;
  expiresAt: string;
  markets: AllocationMarketPlan[];
  transactions: WalletTransaction[];
  notices: string[];
};

export type RelayQuote = {
  provider: "Relay";
  requestId: string;
  originChainId: number;
  destinationChainId: 4663;
  amountInWei: string;
  expectedAmountOutWei: string;
  minimumAmountOutWei: string;
  relayerFeeWei: string;
  relayerFeeUsd: string | null;
  impactPercent: string | null;
  estimatedSeconds: number | null;
  statusPath: string;
  expiresAt: string;
};

export type RelaySolanaQuote = {
  provider: "Relay";
  requestId: string;
  amountInWei: string;
  expectedAmountOutLamports: string;
  minimumAmountOutLamports: string;
  relayerFeeWei: string;
  relayerFeeUsd: string | null;
  impactPercent: string | null;
  estimatedSeconds: number | null;
  statusPath: string;
  expiresAt: string;
};

export type DualChainPlan = {
  kind: "allocate-both";
  owner: `0x${string}`;
  totalAmountWei: string;
  robinhoodShareBps: number;
  expectedConfirmations: 2;
  stages: [
    {
      id: "base-and-fund-robinhood";
      chain: "base";
      chainId: 8453;
      allocation: AllocationPlan;
      bridge: RelayQuote;
      transactions: WalletTransaction[];
    },
    {
      id: "allocate-robinhood";
      chain: "robinhood";
      chainId: 4663;
      waitForRequestId: string;
      allocation: AllocationPlan;
      transactions: WalletTransaction[];
    },
  ];
  notices: string[];
};

export type PositionActionPlan = {
  kind: "compound" | "rebalance" | "withdraw";
  owner: `0x${string}`;
  chain: ChainSlug;
  chainId: number;
  tokenId: string;
  pair: string;
  expectedConfirmations: 1;
  serviceFeeBps: number;
  serviceFee: Array<{ token: `0x${string}`; symbol: string; amount: string }>;
  range?: { tickLower: number; tickUpper: number };
  settlement?: { asset: "ETH"; minimumAmountWei: string; marketSymbol: string };
  transactions: WalletTransaction[];
  createdAt: string;
  expiresAt: string;
  notices: string[];
};

export type IndexMigrationPlan = {
  kind: "index-migration";
  owner: `0x${string}`;
  chain: "robinhood";
  chainId: 4663;
  migrationId: string;
  indexVersion: number;
  tokenId: string;
  fromMarket: { id: string; symbol: string };
  toMarket: { id: string; symbol: string };
  migratedAmountFloorWei: string;
  serviceFeeBps: number;
  serviceFeeWei: string;
  expectedConfirmations: 1;
  execution: "wallet_sendCalls";
  atomic: true;
  transactions: WalletTransaction[];
  createdAt: string;
  expiresAt: string;
  notices: string[];
};

export type PortfolioPlan = AllocationPlan | DualChainPlan;

export type MemeIndexPlan = {
  kind: "meme-index";
  owner: `0x${string}`;
  solanaOwner: string;
  totalAmountWei: string;
  indexVersion: number;
  constituentCount: number;
  expectedWalletSteps: 3;
  createdAt: string;
  expiresAt: string;
  stages: [
    {
      id: "fund-index";
      chain: "base";
      chainId: 8453;
      allocation: AllocationPlan;
      robinhoodBridge: RelayQuote;
      solanaBridge: RelaySolanaQuote;
      solanaServiceFeeWei: string;
      transactions: WalletTransaction[];
    },
    {
      id: "make-robinhood-markets";
      chain: "robinhood";
      chainId: 4663;
      waitForRequestId: string;
      allocation: AllocationPlan;
      transactions: WalletTransaction[];
    },
    {
      id: "make-solana-markets";
      chain: "solana";
      chainId: 792703809;
      waitForRequestId: string;
      amountLamports: string;
      markets: Array<{
        marketId: string;
        symbol: string;
        pool: string;
        weightBps: number;
        amountLamports: string;
        rangeDelta: number;
      }>;
    },
  ];
  notices: string[];
};

export type RobinhoodIndexPlan = {
  kind: "robinhood-index";
  owner: `0x${string}`;
  totalAmountWei: string;
  indexVersion: number;
  constituentCount: number;
  sourceChainId: number;
  sourceChainLabel: string;
  expectedWalletSteps: 1 | 2;
  createdAt: string;
  expiresAt: string;
  stages: [
    {
      id: "fund-robinhood";
      chain: "source";
      chainId: number;
      chainLabel: string;
      bridge: RelayQuote;
      transactions: WalletTransaction[];
    },
    {
      id: "make-robinhood-markets";
      chain: "robinhood";
      chainId: 4663;
      waitForRequestId?: string;
      allocation: AllocationPlan;
      transactions: WalletTransaction[];
    },
  ] | [
    {
      id: "make-robinhood-markets";
      chain: "robinhood";
      chainId: 4663;
      allocation: AllocationPlan;
      transactions: WalletTransaction[];
    },
  ];
  notices: string[];
};
