import { encodeFunctionData, type Address } from "viem";
import type { PlannedTx } from "../types.js";
import { slipstreamNfpmAbi, slipstreamRouterAbi } from "./abi.js";

const BPS = 10_000n;
const MAX_UINT128 = (1n << 128n) - 1n;

function deadline(seconds: number): bigint {
  return BigInt(Math.floor(Date.now() / 1_000) + seconds);
}

function floorForSlippage(amount: bigint, slippageBps: number): bigint {
  return (amount * (BPS - BigInt(slippageBps))) / BPS;
}

export function exactInSlipstreamTx(args: {
  router: Address;
  tokenIn: Address;
  tokenOut: Address;
  tickSpacing: number;
  amountIn: bigint;
  amountOutMin: bigint;
  recipient: Address;
  deadlineSec: number;
}): PlannedTx {
  return {
    to: args.router,
    data: encodeFunctionData({
      abi: slipstreamRouterAbi,
      functionName: "exactInputSingle",
      args: [{
        tokenIn: args.tokenIn,
        tokenOut: args.tokenOut,
        tickSpacing: args.tickSpacing,
        recipient: args.recipient,
        deadline: deadline(args.deadlineSec),
        amountIn: args.amountIn,
        amountOutMinimum: args.amountOutMin,
        sqrtPriceLimitX96: 0n,
      }],
    }),
    value: 0n,
    description: `Aerodrome exact-in ${args.tokenIn} → ${args.tokenOut}`,
  };
}

export function mintSlipstreamTx(args: {
  positionManager: Address;
  token0: Address;
  token1: Address;
  tickSpacing: number;
  tickLower: number;
  tickUpper: number;
  amount0: bigint;
  amount1: bigint;
  recipient: Address;
  slippageBps: number;
  deadlineSec: number;
}): PlannedTx {
  return {
    to: args.positionManager,
    data: encodeFunctionData({
      abi: slipstreamNfpmAbi,
      functionName: "mint",
      args: [{
        token0: args.token0,
        token1: args.token1,
        tickSpacing: args.tickSpacing,
        tickLower: args.tickLower,
        tickUpper: args.tickUpper,
        amount0Desired: args.amount0,
        amount1Desired: args.amount1,
        amount0Min: floorForSlippage(args.amount0, args.slippageBps),
        amount1Min: floorForSlippage(args.amount1, args.slippageBps),
        recipient: args.recipient,
        deadline: deadline(args.deadlineSec),
        sqrtPriceX96: 0n,
      }],
    }),
    value: 0n,
    description: "Aerodrome Slipstream mint",
  };
}

export function collectSlipstreamTx(positionManager: Address, tokenId: bigint, recipient: Address): PlannedTx {
  return {
    to: positionManager,
    data: encodeFunctionData({
      abi: slipstreamNfpmAbi,
      functionName: "collect",
      args: [{ tokenId, recipient, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
    }),
    value: 0n,
    description: "Aerodrome collect",
  };
}

export function increaseSlipstreamTx(args: {
  positionManager: Address;
  tokenId: bigint;
  amount0: bigint;
  amount1: bigint;
  slippageBps: number;
  deadlineSec: number;
}): PlannedTx {
  return {
    to: args.positionManager,
    data: encodeFunctionData({
      abi: slipstreamNfpmAbi,
      functionName: "increaseLiquidity",
      args: [{
        tokenId: args.tokenId,
        amount0Desired: args.amount0,
        amount1Desired: args.amount1,
        amount0Min: floorForSlippage(args.amount0, args.slippageBps),
        amount1Min: floorForSlippage(args.amount1, args.slippageBps),
        deadline: deadline(args.deadlineSec),
      }],
    }),
    value: 0n,
    description: "Aerodrome increaseLiquidity",
  };
}

export function decreaseSlipstreamTx(args: {
  positionManager: Address;
  tokenId: bigint;
  liquidity: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  deadlineSec: number;
  percent?: number;
}): PlannedTx {
  return {
    to: args.positionManager,
    data: encodeFunctionData({
      abi: slipstreamNfpmAbi,
      functionName: "decreaseLiquidity",
      args: [{
        tokenId: args.tokenId,
        liquidity: args.liquidity,
        amount0Min: args.amount0Min,
        amount1Min: args.amount1Min,
        deadline: deadline(args.deadlineSec),
      }],
    }),
    value: 0n,
    description: `Aerodrome decreaseLiquidity ${args.percent ?? 100}%`,
  };
}

export function burnSlipstreamTx(positionManager: Address, tokenId: bigint): PlannedTx {
  return {
    to: positionManager,
    data: encodeFunctionData({ abi: slipstreamNfpmAbi, functionName: "burn", args: [tokenId] }),
    value: 0n,
    description: "Aerodrome burn empty position",
  };
}
