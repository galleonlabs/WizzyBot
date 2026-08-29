import { encodeFunctionData, getAddress, type Address } from "viem";
import { ADDRESSES, DEFAULT_DEADLINE_SEC, DEFAULT_SLIPPAGE_BPS } from "../constants.js";
import { v2RouterAbi } from "../chain/abi.js";
import { erc20ApproveTx } from "./calldata.js";
import type { PlannedTx, PositionSnapshot } from "../types.js";

function deadline(sec = DEFAULT_DEADLINE_SEC): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + sec);
}

export function slipMin(amount: bigint, slippageBps = DEFAULT_SLIPPAGE_BPS): bigint {
  if (amount <= 0n) return 0n;
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}

export function addLiquidityTx(args: {
  tokenA: Address;
  tokenB: Address;
  amountADesired: bigint;
  amountBDesired: bigint;
  recipient: Address;
  slippageBps?: number;
  deadlineSec?: number;
  useNative?: boolean;
  nativeIsTokenA?: boolean;
}): PlannedTx {
  const bps = args.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const minA = slipMin(args.amountADesired, bps);
  const minB = slipMin(args.amountBDesired, bps);
  const to = getAddress(args.recipient);
  const dl = deadline(args.deadlineSec);

  if (args.useNative) {
    const nativeIsA = Boolean(args.nativeIsTokenA);
    const token = nativeIsA ? getAddress(args.tokenB) : getAddress(args.tokenA);
    const amountToken = nativeIsA ? args.amountBDesired : args.amountADesired;
    const amountETH = nativeIsA ? args.amountADesired : args.amountBDesired;
    const amountTokenMin = nativeIsA ? minB : minA;
    const amountETHMin = nativeIsA ? minA : minB;
    return {
      to: ADDRESSES.v2Router,
      data: encodeFunctionData({
        abi: v2RouterAbi,
        functionName: "addLiquidityETH",
        args: [token, amountToken, amountTokenMin, amountETHMin, to, dl],
      }),
      value: amountETH,
      description: "Router02.addLiquidityETH",
    };
  }

  return {
    to: ADDRESSES.v2Router,
    data: encodeFunctionData({
      abi: v2RouterAbi,
      functionName: "addLiquidity",
      args: [
        getAddress(args.tokenA),
        getAddress(args.tokenB),
        args.amountADesired,
        args.amountBDesired,
        minA,
        minB,
        to,
        dl,
      ],
    }),
    value: 0n,
    description: "Router02.addLiquidity",
  };
}

export function removeLiquidityTx(args: {
  tokenA: Address;
  tokenB: Address;
  liquidity: bigint;
  amountAMin?: bigint;
  amountBMin?: bigint;
  recipient: Address;
  slippageBps?: number;
  deadlineSec?: number;
  useNative?: boolean;
  nativeIsTokenA?: boolean;
}): PlannedTx {
  const bps = args.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const minA = args.amountAMin ?? 0n;
  const minB = args.amountBMin ?? 0n;
  void bps;
  const to = getAddress(args.recipient);
  const dl = deadline(args.deadlineSec);

  if (args.useNative) {
    const nativeIsA = Boolean(args.nativeIsTokenA);
    const token = nativeIsA ? getAddress(args.tokenB) : getAddress(args.tokenA);
    const amountTokenMin = nativeIsA ? minB : minA;
    const amountETHMin = nativeIsA ? minA : minB;
    return {
      to: ADDRESSES.v2Router,
      data: encodeFunctionData({
        abi: v2RouterAbi,
        functionName: "removeLiquidityETH",
        args: [token, args.liquidity, amountTokenMin, amountETHMin, to, dl],
      }),
      value: 0n,
      description: "Router02.removeLiquidityETH",
    };
  }

  return {
    to: ADDRESSES.v2Router,
    data: encodeFunctionData({
      abi: v2RouterAbi,
      functionName: "removeLiquidity",
      args: [
        getAddress(args.tokenA),
        getAddress(args.tokenB),
        args.liquidity,
        minA,
        minB,
        to,
        dl,
      ],
    }),
    value: 0n,
    description: "Router02.removeLiquidity",
  };
}

export function v2ApprovePairTx(pair: Address, liquidity: bigint): PlannedTx {
  return erc20ApproveTx(pair, ADDRESSES.v2Router, liquidity);
}

export function v2RemoveFromPosition(
  position: PositionSnapshot,
  recipient: Address,
  pct = 100,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
): PlannedTx {
  const liq = (position.liquidity * BigInt(Math.round(pct))) / 100n;
  const native0 = position.token0.symbol === "ETH";
  const native1 = position.token1.symbol === "ETH";
  return removeLiquidityTx({
    tokenA: position.token0.address,
    tokenB: position.token1.address,
    liquidity: liq,
    amountAMin: slipMin(position.amount0, slippageBps),
    amountBMin: slipMin(position.amount1, slippageBps),
    recipient,
    useNative: native0 || native1,
    nativeIsTokenA: native0,
  });
}

export function v2AddFromPosition(
  position: PositionSnapshot,
  amount0: bigint,
  amount1: bigint,
  recipient: Address,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
): PlannedTx {
  const native0 = position.token0.symbol === "ETH";
  const native1 = position.token1.symbol === "ETH";
  return addLiquidityTx({
    tokenA: position.token0.address,
    tokenB: position.token1.address,
    amountADesired: amount0,
    amountBDesired: amount1,
    recipient,
    slippageBps,
    useNative: native0 || native1,
    nativeIsTokenA: native0,
  });
}
