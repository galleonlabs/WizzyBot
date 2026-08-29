import { getAddress, type Address, type PublicClient } from "viem";
import { encodeSqrtRatioX96 } from "@uniswap/v3-sdk";
import { ADDRESSES, CHAIN_ID, MIN_TICK, MAX_TICK } from "../constants.js";
import { addressesFor, chainIdOfClient, slugOfClient, type ChainSlug } from "../chains.js";
import { V3Adapter, amountsForPosition, readTokenMeta } from "../chain/positions.js";
import { v2FactoryAbi, v2PairAbi, v4PositionManagerAbi, v4StateViewAbi } from "../chain/abi.js";
import { assertUnhooked, decodePositionInfo, loadV4Pool, tokenIdSalt, v4PoolId } from "../chain/v4.js";
import { uncollectedFees } from "../chain/fees-onchain.js";
import { isInRange, percentThroughRange } from "./range.js";
import { pairFromTokenId } from "./protocol.js";
import type { PositionRef, PositionSnapshot, Protocol, ProtocolAdapter, TokenRef } from "../types.js";

export const V4_ADDRESSES = {
  poolManager: ADDRESSES.v4PoolManager,
  positionManager: ADDRESSES.v4PositionManager,
  stateView: ADDRESSES.v4StateView,
};

export const V2_WATCH_PAIRS: readonly [Address, Address][] = [[ADDRESSES.weth, ADDRESSES.usdc]];

export function v2WatchPairsFor(slug: ChainSlug = "base"): readonly [Address, Address][] {
  const a = addressesFor(slug);
  if (slug === "robinhood" && a.usdg) return [[a.weth, a.usdg]];
  return [[a.weth, a.usdc ?? ADDRESSES.usdc]];
}

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

async function metaOrNative(client: PublicClient, currency: Address): Promise<TokenRef> {
  if (currency.toLowerCase() === ADDRESSES.nativeEth.toLowerCase()) {
    return { address: addressesFor(slugOfClient(client)).weth, symbol: "ETH", decimals: 18 };
  }
  return readTokenMeta(client, currency);
}

export class V2Protocol implements ProtocolAdapter {
  readonly protocol = "V2" as const;
  private lastOwner?: Address;

  constructor(private readonly client: PublicClient) {}

  bindOwner(owner: Address): void {
    this.lastOwner = owner;
  }

  async listPositions(owner: Address): Promise<PositionRef[]> {
    this.lastOwner = owner;
    const chainId = chainIdOfClient(this.client);
    const slug = slugOfClient(this.client);
    const addrs = addressesFor(slug);
    const refs: PositionRef[] = [];
    for (const [a, b] of v2WatchPairsFor(slug)) {
      const pair = await this.client.readContract({
        address: addrs.v2Factory,
        abi: v2FactoryAbi,
        functionName: "getPair",
        args: [a, b],
      });
      if (pair === addrs.nativeEth) continue;
      const bal = await this.client.readContract({
        address: pair,
        abi: v2PairAbi,
        functionName: "balanceOf",
        args: [owner],
      });
      if (bal === 0n) continue;
      refs.push({ protocol: "V2", chainId, tokenId: BigInt(pair) });
    }
    return refs;
  }

  async readPosition(tokenId: bigint): Promise<PositionSnapshot> {
    const pair = pairFromTokenId(tokenId);
    const addrs = addressesFor(slugOfClient(this.client));
    const chainId = chainIdOfClient(this.client);
    const [token0Addr, token1Addr, reserves, supply] = await Promise.all([
      this.client.readContract({ address: pair, abi: v2PairAbi, functionName: "token0" }),
      this.client.readContract({ address: pair, abi: v2PairAbi, functionName: "token1" }),
      this.client.readContract({ address: pair, abi: v2PairAbi, functionName: "getReserves" }),
      this.client.readContract({ address: pair, abi: v2PairAbi, functionName: "totalSupply" }),
    ]);
    const owner = this.lastOwner ?? addrs.nativeEth;
    const bal =
      owner === addrs.nativeEth
        ? 0n
        : await this.client.readContract({ address: pair, abi: v2PairAbi, functionName: "balanceOf", args: [owner] });
    const [token0, token1] = await Promise.all([readTokenMeta(this.client, token0Addr), readTokenMeta(this.client, token1Addr)]);
    const amount0 = supply > 0n ? (reserves[0] * bal) / supply : 0n;
    const amount1 = supply > 0n ? (reserves[1] * bal) / supply : 0n;
    const sqrtPriceX96 = BigInt(encodeSqrtRatioX96(reserves[1].toString(), reserves[0].toString()).toString());
    return emptySnap({
      ref: { protocol: "V2", chainId, tokenId },
      owner,
      token0,
      token1,
      fee: 3000,
      tickSpacing: 1,
      tickLower: MIN_TICK,
      tickUpper: MAX_TICK,
      tickCurrent: 0,
      sqrtPriceX96,
      liquidity: bal,
      amount0,
      amount1,
      inRange: true,
      percentThroughRange: 50,
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
    const chainId = chainIdOfClient(this.client);
    const addrs = addressesFor(slugOfClient(this.client));
    const pm = addrs.v4PositionManager;
    const balance = await this.client.readContract({
      address: pm,
      abi: v4PositionManagerAbi,
      functionName: "balanceOf",
      args: [owner],
    });
    const refs: PositionRef[] = [];
    for (let i = 0n; i < balance; i++) {
      const tokenId = await this.client.readContract({
        address: pm,
        abi: v4PositionManagerAbi,
        functionName: "tokenOfOwnerByIndex",
        args: [owner, i],
      });
      refs.push({ protocol: "V4", chainId, tokenId });
    }
    return refs;
  }

  async readPosition(tokenId: bigint): Promise<PositionSnapshot> {
    const addrs = addressesFor(this.client ? slugOfClient(this.client) : "base");
    if (!this.client) {
      throw new Error(`v4 read needs a client. PositionManager=${addrs.v4PositionManager}`);
    }
    const chainId = chainIdOfClient(this.client);
    const pm = addrs.v4PositionManager;
    const [owner, liquidity, packed] = await Promise.all([
      this.client.readContract({ address: pm, abi: v4PositionManagerAbi, functionName: "ownerOf", args: [tokenId] }),
      this.client.readContract({ address: pm, abi: v4PositionManagerAbi, functionName: "getPositionLiquidity", args: [tokenId] }),
      this.client.readContract({ address: pm, abi: v4PositionManagerAbi, functionName: "getPoolAndPositionInfo", args: [tokenId] }),
    ]);
    const [poolKey, info] = packed;
    assertUnhooked(poolKey.hooks);
    const { tickLower, tickUpper } = decodePositionInfo(info);
    const poolId = v4PoolId(poolKey);
    const [token0, token1, slot0, growth, posInfo] = await Promise.all([
      metaOrNative(this.client, poolKey.currency0),
      metaOrNative(this.client, poolKey.currency1),
      this.client.readContract({
        address: addrs.v4StateView,
        abi: v4StateViewAbi,
        functionName: "getSlot0",
        args: [poolId],
      }),
      this.client.readContract({
        address: addrs.v4StateView,
        abi: v4StateViewAbi,
        functionName: "getFeeGrowthInside",
        args: [poolId, tickLower, tickUpper],
      }).catch(() => [0n, 0n] as const),
      this.client.readContract({
        address: addrs.v4StateView,
        abi: v4StateViewAbi,
        functionName: "getPositionInfo",
        args: [poolId, pm, tickLower, tickUpper, tokenIdSalt(tokenId)],
      }).catch(() => [liquidity, 0n, 0n] as const),
    ]);
    const sqrtPriceX96 = slot0[0];
    const tickCurrent = slot0[1];
    const amounts = amountsForPosition({
      token0,
      token1,
      fee: poolKey.fee,
      sqrtPriceX96,
      tickCurrent,
      tickLower,
      tickUpper,
      liquidity,
    });
    const fees = uncollectedFees({
      liquidity,
      tokensOwed0: 0n,
      tokensOwed1: 0n,
      feeGrowthInside0LastX128: posInfo[1],
      feeGrowthInside1LastX128: posInfo[2],
      inside0: growth[0],
      inside1: growth[1],
    });
    return {
      ref: { protocol: "V4", chainId, tokenId },
      owner,
      token0,
      token1,
      fee: poolKey.fee,
      tickSpacing: poolKey.tickSpacing,
      tickLower,
      tickUpper,
      tickCurrent,
      sqrtPriceX96,
      liquidity,
      tokensOwed0: 0n,
      tokensOwed1: 0n,
      uncollected0: fees.amount0 < 0n ? 0n : fees.amount0,
      uncollected1: fees.amount1 < 0n ? 0n : fees.amount1,
      amount0: amounts.amount0,
      amount1: amounts.amount1,
      inRange: isInRange(tickCurrent, tickLower, tickUpper),
      percentThroughRange: percentThroughRange(tickCurrent, tickLower, tickUpper),
      pool: addrs.v4PoolManager,
    };
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

export const V4_NEXT = `v4 PositionManager=${ADDRESSES.v4PositionManager} PoolManager=${ADDRESSES.v4PoolManager} StateView=${ADDRESSES.v4StateView}`;

export { loadV4Pool, v4PoolId };
