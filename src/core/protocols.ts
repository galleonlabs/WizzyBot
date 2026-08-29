import { getAddress, type Address, type PublicClient } from "viem";
import { ADDRESSES, CHAIN_ID } from "../constants.js";
import { V3Adapter, readTokenMeta } from "../chain/positions.js";
import { v2FactoryAbi, v2PairAbi, v4PositionManagerAbi } from "../chain/abi.js";
import type { PositionRef, PositionSnapshot, Protocol, ProtocolAdapter, TokenRef } from "../types.js";

export const V4_ADDRESSES = {
  poolManager: ADDRESSES.v4PoolManager,
  positionManager: ADDRESSES.v4PositionManager,
};

function emptySnap(over: Partial<PositionSnapshot> & Pick<PositionSnapshot, "ref" | "owner" | "pool">): PositionSnapshot {
  const unknown: TokenRef = { address: ADDRESSES.nativeEth, symbol: "?", decimals: 18 };
  return {
    token0: unknown,
    token1: unknown,
    fee: 0,
    tickSpacing: 0,
    tickLower: 0,
    tickUpper: 0,
    tickCurrent: 0,
    sqrtPriceX96: 0n,
    liquidity: 0n,
    tokensOwed0: 0n,
    tokensOwed1: 0n,
    uncollected0: 0n,
    uncollected1: 0n,
    amount0: 0n,
    amount1: 0n,
    inRange: false,
    percentThroughRange: 0,
    ...over,
  };
}

export class V2Protocol implements ProtocolAdapter {
  readonly protocol = "V2" as const;
  private lastOwner?: Address;

  constructor(private readonly client: PublicClient) {}

  async listPositions(owner: Address): Promise<PositionRef[]> {
    this.lastOwner = owner;
    const pair = await this.client.readContract({
      address: ADDRESSES.v2Factory,
      abi: v2FactoryAbi,
      functionName: "getPair",
      args: [ADDRESSES.weth, ADDRESSES.usdc],
    });
    if (pair === ADDRESSES.nativeEth) return [];
    const bal = await this.client.readContract({
      address: pair,
      abi: v2PairAbi,
      functionName: "balanceOf",
      args: [owner],
    });
    if (bal === 0n) return [];
    return [{ protocol: "V2", chainId: CHAIN_ID, tokenId: BigInt(pair) }];
  }

  async readPosition(tokenId: bigint): Promise<PositionSnapshot> {
    const pair = getAddress(`0x${tokenId.toString(16).padStart(40, "0")}`);
    const [token0Addr, token1Addr, reserves, supply] = await Promise.all([
      this.client.readContract({ address: pair, abi: v2PairAbi, functionName: "token0" }),
      this.client.readContract({ address: pair, abi: v2PairAbi, functionName: "token1" }),
      this.client.readContract({ address: pair, abi: v2PairAbi, functionName: "getReserves" }),
      this.client.readContract({ address: pair, abi: v2PairAbi, functionName: "totalSupply" }),
    ]);
    const owner = this.lastOwner ?? ADDRESSES.nativeEth;
    const bal =
      owner === ADDRESSES.nativeEth
        ? 0n
        : await this.client.readContract({ address: pair, abi: v2PairAbi, functionName: "balanceOf", args: [owner] });
    const [token0, token1] = await Promise.all([readTokenMeta(this.client, token0Addr), readTokenMeta(this.client, token1Addr)]);
    const amount0 = supply > 0n ? (reserves[0] * bal) / supply : 0n;
    const amount1 = supply > 0n ? (reserves[1] * bal) / supply : 0n;
    return emptySnap({
      ref: { protocol: "V2", chainId: CHAIN_ID, tokenId },
      owner,
      token0,
      token1,
      fee: 3000,
      liquidity: bal,
      amount0,
      amount1,
      inRange: true,
      pool: pair,
    });
  }
}

export class V3Protocol implements ProtocolAdapter {
  readonly protocol = "V3" as const;
  private readonly inner: V3Adapter;

  constructor(client: PublicClient) {
    this.inner = new V3Adapter(client);
  }

  listPositions(owner: Address): Promise<PositionRef[]> {
    return this.inner.listPositions(owner);
  }

  readPosition(tokenId: bigint): Promise<PositionSnapshot> {
    return this.inner.readPosition(tokenId);
  }

  importViaLogs(owner: Address, fromBlock?: bigint): Promise<bigint[]> {
    return this.inner.importViaLogs(owner, fromBlock);
  }
}

export class V4Protocol implements ProtocolAdapter {
  readonly protocol = "V4" as const;

  constructor(private readonly client?: PublicClient) {}

  async listPositions(owner: Address): Promise<PositionRef[]> {
    if (!this.client) return [];
    const pm = ADDRESSES.v4PositionManager;
    const balance = await this.client.readContract({
      address: pm,
      abi: v4PositionManagerAbi,
      functionName: "balanceOf",
      args: [owner],
    });
    const refs: PositionRef[] = [];
    const n = balance > 25n ? 25n : balance;
    for (let i = 0n; i < n; i++) {
      const tokenId = await this.client.readContract({
        address: pm,
        abi: v4PositionManagerAbi,
        functionName: "tokenOfOwnerByIndex",
        args: [owner, i],
      });
      refs.push({ protocol: "V4", chainId: CHAIN_ID, tokenId });
    }
    return refs;
  }

  async readPosition(tokenId: bigint): Promise<PositionSnapshot> {
    if (!this.client) {
      throw new Error(`v4 read needs a client. PositionManager=${ADDRESSES.v4PositionManager}`);
    }
    const pm = ADDRESSES.v4PositionManager;
    const [owner, liquidity, packed] = await Promise.all([
      this.client.readContract({ address: pm, abi: v4PositionManagerAbi, functionName: "ownerOf", args: [tokenId] }),
      this.client.readContract({ address: pm, abi: v4PositionManagerAbi, functionName: "getPositionLiquidity", args: [tokenId] }),
      this.client.readContract({ address: pm, abi: v4PositionManagerAbi, functionName: "getPoolAndPositionInfo", args: [tokenId] }),
    ]);
    const [poolKey, info] = packed;
    const tickLower = Number((info >> 8n) & 0xffffffn) << 8 >> 8;
    const tickUpper = Number((info >> 32n) & 0xffffffn) << 8 >> 8;
    let token0: TokenRef = { address: poolKey.currency0, symbol: "?", decimals: 18 };
    let token1: TokenRef = { address: poolKey.currency1, symbol: "?", decimals: 18 };
    try {
      if (poolKey.currency0 !== ADDRESSES.nativeEth) token0 = await readTokenMeta(this.client, poolKey.currency0);
      else token0 = { address: ADDRESSES.weth, symbol: "ETH", decimals: 18 };
      if (poolKey.currency1 !== ADDRESSES.nativeEth) token1 = await readTokenMeta(this.client, poolKey.currency1);
      else token1 = { address: ADDRESSES.weth, symbol: "ETH", decimals: 18 };
    } catch {
      // keep placeholders
    }
    return emptySnap({
      ref: { protocol: "V4", chainId: CHAIN_ID, tokenId },
      owner,
      token0,
      token1,
      fee: poolKey.fee,
      tickSpacing: poolKey.tickSpacing,
      tickLower,
      tickUpper,
      liquidity,
      inRange: true,
      pool: ADDRESSES.v4PoolManager,
    });
  }
}

export function adapterFor(protocol: Protocol, client: PublicClient): ProtocolAdapter {
  if (protocol === "V2") return new V2Protocol(client);
  if (protocol === "V4") return new V4Protocol(client);
  return new V3Protocol(client);
}

export function v4AdapterStub(): ProtocolAdapter {
  return new V4Protocol();
}

export const V4_NEXT = `v4 PositionManager=${ADDRESSES.v4PositionManager} PoolManager=${ADDRESSES.v4PoolManager}`;
