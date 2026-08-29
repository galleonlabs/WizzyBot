import type { Address, PublicClient } from "viem";
import { addressesFor, slugOfClient } from "../chains.js";
import { nfpmAbi } from "./abi.js";
import { rememberHold, type HoldRecord, type HoldSource } from "../core/hold.js";

/** Uniswap v3 NFPM on Base. Used only when the caller passes an explicit fromBlock. */
export const NFPM_DEPLOY_BLOCK = 1371680n;

const DEFAULT_LOOKBACK = 50_000n;
const CHUNK = 10_000n;
const MAX_CHUNKS = 20;

const SUBGRAPHS = [
  "https://api.studio.thegraph.com/query/48211/uniswap-v3-base/version/latest",
  "https://api.studio.thegraph.com/query/54366/uniswap-v3-base/version/latest",
];

export interface MintHistory {
  tokenId: bigint;
  amount0: bigint;
  amount1: bigint;
  createdAt: number;
  source: HoldSource;
  note?: string;
}

async function latestBlock(client: PublicClient): Promise<bigint | undefined> {
  try {
    return await client.getBlockNumber();
  } catch {
    return undefined;
  }
}

function windowFor(latest: bigint, fromBlock?: bigint): { start: bigint; chunks: number } {
  if (fromBlock !== undefined) {
    return { start: fromBlock, chunks: MAX_CHUNKS };
  }
  const start = latest > DEFAULT_LOOKBACK ? latest - DEFAULT_LOOKBACK : 0n;
  return { start, chunks: MAX_CHUNKS };
}

export async function fetchIncreaseLiquidity(
  client: PublicClient,
  tokenId: bigint,
  fromBlock?: bigint,
  positionManager?: Address,
): Promise<MintHistory | undefined> {
  const nfpm = positionManager ?? addressesFor(slugOfClient(client)).nfpm;
  const latest = await latestBlock(client);
  if (latest === undefined) return undefined;
  const { start, chunks } = windowFor(latest, fromBlock);
  let cursor = start;
  let used = 0;
  while (cursor <= latest && used < chunks) {
    const to = cursor + CHUNK > latest ? latest : cursor + CHUNK;
    try {
      const logs = await client.getContractEvents({
        address: nfpm,
        abi: nfpmAbi,
        eventName: "IncreaseLiquidity",
        args: { tokenId },
        fromBlock: cursor,
        toBlock: to,
      });
      if (logs.length > 0) {
        const first = logs[0]!;
        const args = first.args as { amount0?: bigint; amount1?: bigint };
        const block = first.blockNumber
          ? await client.getBlock({ blockNumber: first.blockNumber })
          : undefined;
        return {
          tokenId,
          amount0: args.amount0 ?? 0n,
          amount1: args.amount1 ?? 0n,
          createdAt: block ? Number(block.timestamp) : Math.floor(Date.now() / 1000),
          source: "increase-liquidity-log",
        };
      }
    } catch {
      // public RPCs often reject large ranges — skip this chunk
    }
    cursor = to + 1n;
    used += 1;
  }
  return undefined;
}

export async function fetchMintTransfer(
  client: PublicClient,
  tokenId: bigint,
  fromBlock?: bigint,
  positionManager?: Address,
): Promise<{ to: Address; createdAt: number } | undefined> {
  const nfpm = positionManager ?? addressesFor(slugOfClient(client)).nfpm;
  const latest = await latestBlock(client);
  if (latest === undefined) return undefined;
  const { start, chunks } = windowFor(latest, fromBlock);
  let cursor = start;
  let used = 0;
  const zero = "0x0000000000000000000000000000000000000000";
  while (cursor <= latest && used < chunks) {
    const toBlock = cursor + CHUNK > latest ? latest : cursor + CHUNK;
    try {
      const logs = await client.getContractEvents({
        address: nfpm,
        abi: nfpmAbi,
        eventName: "Transfer",
        args: { from: zero as Address, tokenId },
        fromBlock: cursor,
        toBlock,
      });
      if (logs.length > 0) {
        const first = logs[0]!;
        const args = first.args as { to?: Address };
        const block = first.blockNumber
          ? await client.getBlock({ blockNumber: first.blockNumber })
          : undefined;
        if (args.to) {
          return {
            to: args.to,
            createdAt: block ? Number(block.timestamp) : Math.floor(Date.now() / 1000),
          };
        }
      }
    } catch {
      // skip chunk
    }
    cursor = toBlock + 1n;
    used += 1;
  }
  return undefined;
}

/** Best-effort community subgraph. Verified at runtime; ignored on failure. */
export async function fetchHoldFromSubgraph(tokenId: bigint): Promise<MintHistory | undefined> {
  const query = {
    query: `{ position(id: "${tokenId.toString()}") { id depositedToken0 depositedToken1 transaction { timestamp } } }`,
  };
  for (const url of SUBGRAPHS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(query),
        signal: AbortSignal.timeout(6_000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        data?: {
          position?: {
            depositedToken0?: string;
            depositedToken1?: string;
            transaction?: { timestamp?: string };
          };
        };
      };
      const pos = json.data?.position;
      if (!pos?.depositedToken0 && !pos?.depositedToken1) continue;
      // Uniswap subgraph deposited* are decimal-adjusted, not raw. Skip as HOLD baseline.
      return undefined;
    } catch {
      continue;
    }
  }
  return undefined;
}

export async function importHoldForToken(
  client: PublicClient,
  tokenId: bigint,
  current: { amount0: bigint; amount1: bigint },
  opts: { path?: string; fromBlock?: bigint; positionManager?: Address } = {},
): Promise<HoldRecord> {
  const history = await fetchIncreaseLiquidity(client, tokenId, opts.fromBlock, opts.positionManager);
  if (history) {
    return rememberHold(tokenId, history.amount0, history.amount1, history.source, {
      createdAt: history.createdAt,
      path: opts.path,
    }).record;
  }
  if (!opts.positionManager) await fetchHoldFromSubgraph(tokenId);
  const transfer = await fetchMintTransfer(client, tokenId, opts.fromBlock, opts.positionManager);
  return rememberHold(tokenId, current.amount0, current.amount1, "first-seen-import", {
    createdAt: transfer?.createdAt,
    path: opts.path,
    note: "Mint predates this store or IncreaseLiquidity logs were unavailable. HOLD is first-seen inventory, not the original mint bag.",
  }).record;
}

/** Resolve a transparent HOLD baseline without writing server-side state. */
export async function readHoldBaseline(
  client: PublicClient,
  tokenId: bigint,
  current: { amount0: bigint; amount1: bigint },
  opts: { fromBlock?: bigint; positionManager?: Address } = {},
): Promise<HoldRecord> {
  const history = await fetchIncreaseLiquidity(client, tokenId, opts.fromBlock, opts.positionManager);
  if (history) {
    return {
      tokenId: tokenId.toString(),
      hold0: history.amount0.toString(),
      hold1: history.amount1.toString(),
      createdAt: history.createdAt,
      source: history.source,
    };
  }
  const transfer = await fetchMintTransfer(client, tokenId, opts.fromBlock, opts.positionManager);
  return {
    tokenId: tokenId.toString(),
    hold0: current.amount0.toString(),
    hold1: current.amount1.toString(),
    createdAt: transfer?.createdAt ?? 0,
    source: "first-seen-import",
    note: "Original mint inventory was not available from the bounded log scan. HOLD comparisons use current first-seen inventory and are not historical PnL.",
  };
}

export async function simulateTxs(
  client: PublicClient,
  from: Address,
  txs: { to: Address; data: `0x${string}`; value: bigint; description: string }[],
): Promise<{ description: string; ok: boolean; error?: string }[]> {
  const out: { description: string; ok: boolean; error?: string }[] = [];
  for (const tx of txs) {
    try {
      await client.call({
        account: from,
        to: tx.to,
        data: tx.data,
        value: tx.value,
      });
      out.push({ description: tx.description, ok: true });
    } catch (err) {
      out.push({
        description: tx.description,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}
