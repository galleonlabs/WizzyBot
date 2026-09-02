import type { ChainSlug } from "./chains";
import type { WalletTransaction } from "./wallet-calls";

export type MarketRisk = "established" | "emerging" | "experimental";

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
  status: "active" | "paused" | "watch";
  risk: MarketRisk;
  imageUrl?: string;
  color: string;
  liquidityVenues?: Array<
    | { protocol: "V2"; pool: `0x${string}` }
    | { protocol: "V4"; poolId: `0x${string}`; quoteSymbol: "ETH"; fee: number; tickSpacing: number; hooks: `0x${string}` }
  >;
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
  poolAgeDays: number | null;
  energy: number | null;
  sourceUrl: string | null;
  asOf: string;
};

export type MarketsPayload = {
  catalog: MarketCatalog;
  solana: SolanaChainCatalog;
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
  protocol: "V2" | "V3" | "V4";
  venue: "uniswap-v2" | "uniswap-v3" | "uniswap-v4" | "aerodrome-slipstream";
  liquidityTarget: `0x${string}`;
  quoteSymbol: "ETH" | "WETH";
  budgetWei: string;
  swapInWei: string;
  quotedMemeOut: string;
  minimumMemeOut: string;
  mintQuote: string;
  mintMeme: string;
  tickLower: number;
  tickUpper: number;
  leftoverQuote: string;
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
  execution: "wallet_transactions";
  atomic: false;
  createdAt: string;
  expiresAt: string;
  markets: AllocationMarketPlan[];
  transactions: WalletTransaction[];
  allowedTargets: `0x${string}`[];
  notices: string[];
  venueSelection?: {
    methodology: "venue-quality-v1";
    selectedKey: "PRIMARY" | "V2" | "V4";
    selectedProtocol: "V2" | "V3" | "V4" | "AERODROME_SLIPSTREAM";
    selectedPoolReference: `0x${string}`;
    switched: boolean;
    confidence: "high" | "guarded" | "fallback";
    decisionReasons: string[];
  };
};

export type PositionActionKind = "collect" | "compound" | "increase" | "decrease" | "rebalance" | "withdraw";

export type PositionActionPlan = {
  kind: PositionActionKind;
  owner: `0x${string}`;
  chain: ChainSlug;
  chainId: number;
  tokenId: string;
  pair: string;
  execution: "wallet_transactions";
  atomic: false;
  expectedConfirmations: 1;
  serviceFeeBps: number;
  serviceFee: Array<{ token: `0x${string}`; symbol: string; amount: string }>;
  funding?: {
    amountWei: string;
    serviceFeeWei: string;
    netAmountWei: string;
    quoteSymbol: "ETH" | "WETH";
    quoteAmount: string;
    memeSymbol: string;
    memeAmount: string;
  };
  range?: {
    tickLower: number;
    tickUpper: number;
    currentTick: number;
    previousTickLower: number;
    previousTickUpper: number;
    preset?: "focused" | "balanced" | "wide";
    swap?: { tokenIn: string; tokenOut: string; amountIn: string; minimumAmountOut: string };
  };
  removal?: { percent: number; amount0: string; amount1: string; burn: boolean };
  settlement?: { asset: "ETH"; minimumAmountWei: string; marketSymbol: string };
  tokens?: { symbol0: string; decimals0: number; symbol1: string; decimals1: number };
  transactions: WalletTransaction[];
  allowedTargets: `0x${string}`[];
  createdAt: string;
  expiresAt: string;
  notices: string[];
};
