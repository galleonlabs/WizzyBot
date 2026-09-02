import { getAddress, type Address, type PublicClient } from "viem";
import { amountsForPosition, readTokenMeta } from "../chain/positions.js";
import { feeGrowthInside, uncollectedFees } from "../chain/fees-onchain.js";
import { isInRange, percentThroughRange } from "../core/range.js";
import type { PositionRef, PositionSnapshot, ProtocolAdapter } from "../types.js";
import { slipstreamFactoryAbi, slipstreamNfpmAbi, slipstreamPoolAbi } from "./abi.js";
import { aerodromeDeployment, type AerodromeDeploymentId } from "./deployments.js";

export class AerodromeSlipstreamAdapter implements ProtocolAdapter {
  readonly protocol = "V3" as const;

  constructor(
    private readonly client: PublicClient,
    readonly deploymentId: AerodromeDeploymentId,
  ) {}

  async listPositions(owner: Address): Promise<PositionRef[]> {
    const deployment = aerodromeDeployment(this.deploymentId);
    const balance = await this.client.readContract({
      address: deployment.positionManager,
      abi: slipstreamNfpmAbi,
      functionName: "balanceOf",
      args: [owner],
    });
    const tokenIds = await Promise.all(Array.from({ length: Number(balance) }, (_, index) => this.client.readContract({
      address: deployment.positionManager,
      abi: slipstreamNfpmAbi,
      functionName: "tokenOfOwnerByIndex",
      args: [owner, BigInt(index)],
    })));
    return tokenIds.map((tokenId): PositionRef => ({
      protocol: "V3",
      chainId: 8453,
      tokenId,
      venue: "aerodrome-slipstream",
      positionManager: deployment.positionManager,
    }));
  }

  async readPosition(tokenId: bigint): Promise<PositionSnapshot> {
    const deployment = aerodromeDeployment(this.deploymentId);
    const position = await this.client.readContract({
      address: deployment.positionManager,
      abi: slipstreamNfpmAbi,
      functionName: "positions",
      args: [tokenId],
    });
    const [
      ,
      ,
      token0Address,
      token1Address,
      tickSpacing,
      tickLower,
      tickUpper,
      liquidity,
      feeGrowthInside0LastX128,
      feeGrowthInside1LastX128,
      tokensOwed0,
      tokensOwed1,
    ] = position;
    const [owner, pool, token0, token1] = await Promise.all([
      this.client.readContract({
        address: deployment.positionManager,
        abi: slipstreamNfpmAbi,
        functionName: "ownerOf",
        args: [tokenId],
      }),
      this.client.readContract({
        address: deployment.factory,
        abi: slipstreamFactoryAbi,
        functionName: "getPool",
        args: [token0Address, token1Address, tickSpacing],
      }),
      readTokenMeta(this.client, token0Address),
      readTokenMeta(this.client, token1Address),
    ]);
    const poolAddress = getAddress(pool);
    const [slot0, fee, nft, feeGrowthGlobal0X128, feeGrowthGlobal1X128, lowerTick, upperTick] = await Promise.all([
      this.client.readContract({ address: poolAddress, abi: slipstreamPoolAbi, functionName: "slot0" }),
      this.client.readContract({ address: poolAddress, abi: slipstreamPoolAbi, functionName: "fee" }),
      this.client.readContract({ address: poolAddress, abi: slipstreamPoolAbi, functionName: "nft" }),
      this.client.readContract({ address: poolAddress, abi: slipstreamPoolAbi, functionName: "feeGrowthGlobal0X128" }),
      this.client.readContract({ address: poolAddress, abi: slipstreamPoolAbi, functionName: "feeGrowthGlobal1X128" }),
      this.client.readContract({ address: poolAddress, abi: slipstreamPoolAbi, functionName: "ticks", args: [tickLower] }),
      this.client.readContract({ address: poolAddress, abi: slipstreamPoolAbi, functionName: "ticks", args: [tickUpper] }),
    ]);
    if (nft.toLowerCase() !== deployment.positionManager.toLowerCase()) {
      throw new Error(`Aerodrome pool ${poolAddress} does not belong to the configured position manager`);
    }
    const [sqrtPriceX96, tickCurrent] = slot0;
    const inside = feeGrowthInside({
      tickCurrent,
      tickLower,
      tickUpper,
      feeGrowthGlobal0X128,
      feeGrowthGlobal1X128,
      lower: { feeGrowthOutside0X128: lowerTick[3], feeGrowthOutside1X128: lowerTick[4] },
      upper: { feeGrowthOutside0X128: upperTick[3], feeGrowthOutside1X128: upperTick[4] },
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
      chainId: 8453,
      token0,
      token1,
      fee,
      tickSpacing,
      sqrtPriceX96,
      tickCurrent,
      tickLower,
      tickUpper,
      liquidity,
    });

    return {
      ref: {
        protocol: "V3",
        chainId: 8453,
        tokenId,
        venue: "aerodrome-slipstream",
        positionManager: deployment.positionManager,
      },
      owner,
      token0,
      token1,
      fee,
      tickSpacing,
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
      pool: poolAddress,
      venue: "aerodrome-slipstream",
      positionManager: deployment.positionManager,
      factory: deployment.factory,
    };
  }
}
