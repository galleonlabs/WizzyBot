import {
  createPublicClient,
  formatEther,
  http,
  parseAbiItem,
  type Address,
  type Hash,
} from "viem";
import { ROBINHOOD_RPC_DEFAULT, viemChainFor } from "../chains.js";
import { loadEnv } from "../config/env.js";
import { activeMarkets, type CuratedMarket } from "./catalog.js";

export const V3_MINT_EVENT = parseAbiItem(
  "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
);
export const V3_BURN_EVENT = parseAbiItem(
  "event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
);

const BLOCK_WINDOW = 2_400n;
const ACTIVITY_LIMIT = 16;
const ROBINHOOD_EXPLORER = "https://robinhoodchain.blockscout.com";

export type PoolActivityKind = "added" | "removed";

export type PoolActivityItem = {
  id: string;
  kind: PoolActivityKind;
  marketId: string;
  symbol: string;
  pair: string;
  wethAmount: string | null;
  transactionHash: Hash;
  transactionUrl: string;
  blockNumber: string;
};

export type PoolActivityPayload = {
  items: PoolActivityItem[];
  asOfBlock: string;
  scannedBlocks: number;
  rpcRequests: 2;
};

export type DecodedPoolActivityLog = {
  address: Address;
  eventName: "Mint" | "Burn";
  args: { amount0?: bigint; amount1?: bigint };
  blockNumber: bigint | null;
  transactionHash: Hash | null;
  logIndex: number | null;
};

export type PoolActivityClient = {
  getBlockNumber: () => Promise<bigint>;
  getLogs: (input: {
    address: Address[];
    events: readonly [typeof V3_MINT_EVENT, typeof V3_BURN_EVENT];
    fromBlock: bigint;
    toBlock: bigint;
    strict: true;
  }) => Promise<DecodedPoolActivityLog[]>;
};

export function derivePoolActivity(
  markets: readonly CuratedMarket[],
  logs: readonly DecodedPoolActivityLog[],
  limit = ACTIVITY_LIMIT,
): PoolActivityItem[] {
  const byPool = new Map(markets.map((market) => [market.pool.toLowerCase(), market]));
  return [...logs]
    .filter((log) => log.blockNumber !== null && log.transactionHash !== null)
    .sort((a, b) => {
      const blockDelta = (b.blockNumber ?? 0n) - (a.blockNumber ?? 0n);
      return blockDelta === 0n ? (b.logIndex ?? 0) - (a.logIndex ?? 0) : blockDelta > 0n ? 1 : -1;
    })
    .flatMap((log): PoolActivityItem[] => {
      const market = byPool.get(log.address.toLowerCase());
      if (!market || !log.transactionHash || log.blockNumber === null) return [];
      const quoteIsToken0 = market.quoteToken.toLowerCase() < market.token.toLowerCase();
      const wethRaw = quoteIsToken0 ? log.args.amount0 : log.args.amount1;
      const wethAmount = wethRaw && wethRaw > 0n ? formatActivityEth(wethRaw) : null;
      return [{
        id: `${log.transactionHash}-${log.logIndex ?? 0}`,
        kind: log.eventName === "Mint" ? "added" : "removed",
        marketId: market.id,
        symbol: market.symbol,
        pair: `${market.symbol}/${market.quoteSymbol}`,
        wethAmount,
        transactionHash: log.transactionHash,
        transactionUrl: `${ROBINHOOD_EXPLORER}/tx/${log.transactionHash}`,
        blockNumber: log.blockNumber.toString(),
      }];
    })
    .slice(0, Math.max(0, limit));
}

export async function fetchRecentPoolActivity(options: {
  client?: PoolActivityClient;
  blockWindow?: bigint;
  limit?: number;
} = {}): Promise<PoolActivityPayload> {
  const markets = activeMarkets("robinhood").filter((market) => market.protocol === "V3");
  const rpcUrl = loadEnv().rpcByChain.robinhood || ROBINHOOD_RPC_DEFAULT;
  const client = options.client ?? createPublicClient({
    chain: viemChainFor("robinhood"),
    transport: http(rpcUrl, { retryCount: 3, retryDelay: 500, timeout: 15_000 }),
  }) as unknown as PoolActivityClient;
  const toBlock = await client.getBlockNumber();
  const blockWindow = options.blockWindow ?? BLOCK_WINDOW;
  const fromBlock = toBlock >= blockWindow ? toBlock - blockWindow + 1n : 0n;
  const logs = await client.getLogs({
    address: markets.map((market) => market.pool),
    events: [V3_MINT_EVENT, V3_BURN_EVENT],
    fromBlock,
    toBlock,
    strict: true,
  });
  return {
    items: derivePoolActivity(markets, logs, options.limit),
    asOfBlock: toBlock.toString(),
    scannedBlocks: Number(toBlock - fromBlock + 1n),
    rpcRequests: 2,
  };
}

function formatActivityEth(value: bigint): string {
  const amount = Number(formatEther(value));
  if (!Number.isFinite(amount)) return formatEther(value);
  if (amount >= 1_000) return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(amount);
  if (amount >= 10) return amount.toFixed(1).replace(/\.0$/, "");
  if (amount >= 1) return amount.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  if (amount >= 0.01) return amount.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return "<0.01";
}
