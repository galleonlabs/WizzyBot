import { type Address, type PublicClient } from "viem";
import { Token } from "@uniswap/sdk-core";
import { Pool, Position as SdkPosition } from "@uniswap/v3-sdk";
import { ADDRESSES, CHAIN_ID } from "../constants.js";
import { factoryAbi, nfpmAbi, poolAbi, erc20Abi } from "./abi.js";
import { feeGrowthInside, uncollectedFees } from "./fees-onchain.js";
import { isInRange, percentThroughRange } from "../core/range.js";
import { tickSpacingForFee } from "../core/ticks.js";
import type { PositionRef, PositionSnapshot, ProtocolAdapter, TokenRef } from "../types.js";

export class V3Adapter implements ProtocolAdapter {
  readonly protocol = "V3" as const;

  constructor(private readonly client: PublicClient) {}

  async listPositions(owner: Address): Promise<PositionRef[]> {
    const balance = await this.client.readContract({
      address: ADDRESSES.nfpm,
      abi: nfpmAbi,
      functionName: "balanceOf",
      args: [owner],
    });
    const refs: PositionRef[] = [];
    for (let i = 0n; i < balance; i++) {
      const tokenId = await this.client.readContract({
        address: ADDRESSES.nfpm,
        abi: nfpmAbi,
        functionName: "tokenOfOwnerByIndex",
        args: [owner, i],
      });
      refs.push({ protocol: "V3", chainId: CHAIN_ID, tokenId });
    }
    return refs;
  }

  async importViaLogs(owner: Address, fromBlock?: bigint): Promise<bigint[]> {
    const logs = await this.client.getContractEvents({
      address: ADDRESSES.nfpm,
      abi: nfpmAbi,
      eventName: "Transfer",
      args: { to: owner },
      fromBlock: fromBlock ?? 0n,
    });
    const ids = new Set<bigint>();
    for (const log of logs) {
      const tokenId = (log as { args?: { tokenId?: bigint } }).args?.tokenId;
      if (tokenId !== undefined) ids.add(tokenId);
    }
    const owned: bigint[] = [];
    for (const id of ids) {
      try {
        const current = await this.client.readContract({
          address: ADDRESSES.nfpm,
          abi: nfpmAbi,
          functionName: "ownerOf",
          args: [id],
        });
        if (current.toLowerCase() === owner.toLowerCase()) owned.push(id);
      } catch {
        // burned
      }
    }
    return owned;
  }

  async readPosition(tokenId: bigint): Promise<PositionSnapshot> {
    const pos = await this.client.readContract({
      address: ADDRESSES.nfpm,
      abi: nfpmAbi,
      functionName: "positions",
      args: [tokenId],
    });

    const [
      ,
      ,
      token0Addr,
      token1Addr,
      fee,
      tickLower,
      tickUpper,
      liquidity,
      feeGrowthInside0LastX128,
      feeGrowthInside1LastX128,
      tokensOwed0,
      tokensOwed1,
    ] = pos;

    const owner = await this.client.readContract({
      address: ADDRESSES.nfpm,
      abi: nfpmAbi,
      functionName: "ownerOf",
      args: [tokenId],
    });

    const poolAddr = await this.client.readContract({
      address: ADDRESSES.factory,
      abi: factoryAbi,
      functionName: "getPool",
      args: [token0Addr, token1Addr, fee],
    });

    const [slot0, feeGrowthGlobal0X128, feeGrowthGlobal1X128, lowerTick, upperTick, token0Meta, token1Meta] =
      await Promise.all([
        this.client.readContract({ address: poolAddr, abi: poolAbi, functionName: "slot0" }),
        this.client.readContract({ address: poolAddr, abi: poolAbi, functionName: "feeGrowthGlobal0X128" }),
        this.client.readContract({ address: poolAddr, abi: poolAbi, functionName: "feeGrowthGlobal1X128" }),
        this.client.readContract({ address: poolAddr, abi: poolAbi, functionName: "ticks", args: [tickLower] }),
        this.client.readContract({ address: poolAddr, abi: poolAbi, functionName: "ticks", args: [tickUpper] }),
        readToken(this.client, token0Addr),
        readToken(this.client, token1Addr),
      ]);

    const [sqrtPriceX96, tickCurrent] = slot0;
    const inside = feeGrowthInside({
      tickCurrent,
      tickLower,
      tickUpper,
      feeGrowthGlobal0X128,
      feeGrowthGlobal1X128,
      lower: {
        feeGrowthOutside0X128: lowerTick[2],
        feeGrowthOutside1X128: lowerTick[3],
      },
      upper: {
        feeGrowthOutside0X128: upperTick[2],
        feeGrowthOutside1X128: upperTick[3],
      },
    });
    const fees = uncollectedFees({
      liquidity,
      tokensOwed0,
      tokensOwed1,
      feeGrowthInside0LastX128,
      feeGrowthInside1LastX128,
      inside0: inside.inside0,
      inside1: inside.inside1,
    });

    const amounts = amountsForPosition({
      token0: token0Meta,
      token1: token1Meta,
      fee,
      sqrtPriceX96,
      tickCurrent,
      tickLower,
      tickUpper,
      liquidity,
    });

    return {
      ref: { protocol: "V3", chainId: CHAIN_ID, tokenId },
      owner,
      token0: token0Meta,
      token1: token1Meta,
      fee,
      tickSpacing: tickSpacingForFee(fee),
      tickLower,
      tickUpper,
      tickCurrent,
      sqrtPriceX96,
      liquidity,
      tokensOwed0,
      tokensOwed1,
      uncollected0: fees.amount0,
      uncollected1: fees.amount1,
      amount0: amounts.amount0,
      amount1: amounts.amount1,
      inRange: isInRange(tickCurrent, tickLower, tickUpper),
      percentThroughRange: percentThroughRange(tickCurrent, tickLower, tickUpper),
      pool: poolAddr,
    };
  }
}

async function readToken(client: PublicClient, address: Address): Promise<TokenRef> {
  const [decimals, symbol] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
  ]);
  return { address, symbol, decimals };
}

export function amountsForPosition(args: {
  token0: TokenRef;
  token1: TokenRef;
  fee: number;
  sqrtPriceX96: bigint;
  tickCurrent: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}): { amount0: bigint; amount1: bigint } {
  if (args.liquidity === 0n) return { amount0: 0n, amount1: 0n };
  const t0 = new Token(CHAIN_ID, args.token0.address, args.token0.decimals, args.token0.symbol);
  const t1 = new Token(CHAIN_ID, args.token1.address, args.token1.decimals, args.token1.symbol);
  const pool = new Pool(t0, t1, args.fee, args.sqrtPriceX96.toString(), "0", args.tickCurrent);
  const position = new SdkPosition({
    pool,
    liquidity: args.liquidity.toString(),
    tickLower: args.tickLower,
    tickUpper: args.tickUpper,
  });
  return {
    amount0: BigInt(position.amount0.quotient.toString()),
    amount1: BigInt(position.amount1.quotient.toString()),
  };
}

export function v4AdapterStub(): ProtocolAdapter {
  return {
    protocol: "V4",
    async listPositions(): Promise<PositionRef[]> {
      throw new Error("Uniswap v4 is not implemented in UnaBot v1 (Base v3 only)");
    },
    async readPosition(): Promise<PositionSnapshot> {
      throw new Error("Uniswap v4 is not implemented in UnaBot v1 (Base v3 only)");
    },
  };
}
