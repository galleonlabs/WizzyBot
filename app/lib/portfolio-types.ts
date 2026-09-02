import type { ChainSlug } from "./chains";
import type { WalletTransaction } from "./wallet-calls";

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

export type PoolsPayload = {
  pools: CuratedPool[];
  asOf: string;
  scanned: number;
  excluded: number;
  degraded: string[];
};

export type RelayCurrency = { chainId: number; address: string; symbol: string; decimals: number };

export type RelayTransaction = WalletTransaction & { chainId: number };

export type RelaySwapQuote = {
  provider: "Relay";
  requestId: string;
  owner: `0x${string}`;
  originChainId: number;
  destinationChainId: number;
  currencyIn: RelayCurrency;
  currencyOut: RelayCurrency;
  amountIn: string;
  expectedAmountOut: string;
  minimumAmountOut: string;
  amountOutUsd: string | null;
  fees: { appBps: number; appAmount: string; appUsd: string | null; relayerUsd: string | null; gasUsd: string | null };
  impactPercent: string | null;
  estimatedSeconds: number | null;
  steps: Array<{ id: string; description: string; transactions: RelayTransaction[] }>;
  transactions: RelayTransaction[];
  statusPath: string;
  createdAt: string;
  expiresAt: string;
  notices: string[];
};

export type RelayChainOption = { id: number; label: string; slug: string };

export const RELAY_CHAINS: readonly RelayChainOption[] = [
  { id: 8453, label: "Base", slug: "base" },
  { id: 4663, label: "Robinhood Chain", slug: "robinhood" },
  { id: 1, label: "Ethereum", slug: "ethereum" },
  { id: 42161, label: "Arbitrum", slug: "arbitrum" },
  { id: 10, label: "Optimism", slug: "optimism" },
];

export type PositionActionKind = "collect" | "decrease" | "withdraw";

export type PositionActionPlan = {
  kind: PositionActionKind;
  owner: `0x${string}`;
  chain: ChainSlug;
  chainId: number;
  tokenId: string;
  pair: string;
  execution: "wallet_transactions";
  atomic: true;
  expectedConfirmations: 1;
  serviceFeeBps: 0;
  removal?: { percent: number; amount0: string; amount1: string; burn: boolean };
  tokens: { symbol0: string; decimals0: number; address0: `0x${string}`; symbol1: string; decimals1: number; address1: `0x${string}` };
  transactions: WalletTransaction[];
  allowedTargets: `0x${string}`[];
  createdAt: string;
  expiresAt: string;
  notices: string[];
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
