import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  padHex,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { ADDRESSES, DEFAULT_DEADLINE_SEC, DEFAULT_SLIPPAGE_BPS } from "../constants.js";
import { addressesFor, slugForChainId } from "../chains.js";
import { permit2Abi, v4PositionManagerWriteAbi, type V4PoolKey } from "../chain/abi.js";
import { tickSpacingForFee } from "../core/ticks.js";
import type { PlannedTx, PositionSnapshot, TokenRef } from "../types.js";

/** Official v4-periphery Actions (Uniswap/v4-periphery Actions.sol). */
export const V4_ACTIONS = {
  INCREASE_LIQUIDITY: 0x00,
  DECREASE_LIQUIDITY: 0x01,
  MINT_POSITION: 0x02,
  BURN_POSITION: 0x03,
  SETTLE_PAIR: 0x0d,
  TAKE_PAIR: 0x11,
  SWEEP: 0x14,
} as const;

const POOL_KEY = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;

function deadline(sec = DEFAULT_DEADLINE_SEC): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + sec);
}

export function slipMax(amount: bigint, slippageBps = DEFAULT_SLIPPAGE_BPS): bigint {
  if (amount <= 0n) return 0n;
  return (amount * BigInt(10_000 + slippageBps)) / 10_000n;
}

export function slipMin(amount: bigint, slippageBps = DEFAULT_SLIPPAGE_BPS): bigint {
  if (amount <= 0n) return 0n;
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}

/** v4 native pairs use address(0), not WETH. Snapshot may store WETH + symbol ETH. */
export function v4Currency(token: TokenRef, chainId = 8453): Address {
  const addresses = addressesFor(slugForChainId(chainId));
  if (token.address.toLowerCase() === addresses.nativeEth.toLowerCase()) return addresses.nativeEth;
  if (token.symbol === "ETH" && token.address.toLowerCase() === addresses.weth.toLowerCase()) {
    return addresses.nativeEth;
  }
  return getAddress(token.address);
}

export function poolKeyFromPosition(position: PositionSnapshot, hooks: Address = ADDRESSES.nativeEth): V4PoolKey {
  const currency0 = v4Currency(position.token0, position.ref.chainId);
  const currency1 = v4Currency(position.token1, position.ref.chainId);
  const [c0, c1] = currency0.toLowerCase() < currency1.toLowerCase() ? [currency0, currency1] : [currency1, currency0];
  return {
    currency0: c0,
    currency1: c1,
    fee: position.fee,
    tickSpacing: position.tickSpacing || tickSpacingForFee(position.fee),
    hooks: getAddress(hooks),
  };
}

export function encodeModifyLiquidities(actions: number[], params: Hex[], deadlineSec = DEFAULT_DEADLINE_SEC): Hex {
  const packed = concatHex(actions.map((a) => padHex(toHex(a), { size: 1 })));
  const unlockData = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [packed, params]);
  return encodeFunctionData({
    abi: v4PositionManagerWriteAbi,
    functionName: "modifyLiquidities",
    args: [unlockData, deadline(deadlineSec)],
  });
}

function mintParams(args: {
  poolKey: V4PoolKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
  recipient: Address;
  hookData?: Hex;
  chainId?: number;
}): Hex {
  return encodeAbiParameters(
    [
      POOL_KEY,
      { type: "int24" },
      { type: "int24" },
      { type: "uint256" },
      { type: "uint128" },
      { type: "uint128" },
      { type: "address" },
      { type: "bytes" },
    ],
    [
      {
        currency0: args.poolKey.currency0,
        currency1: args.poolKey.currency1,
        fee: args.poolKey.fee,
        tickSpacing: args.poolKey.tickSpacing,
        hooks: args.poolKey.hooks,
      },
      args.tickLower,
      args.tickUpper,
      args.liquidity,
      args.amount0Max,
      args.amount1Max,
      getAddress(args.recipient),
      args.hookData ?? "0x",
    ],
  );
}

function increaseParams(tokenId: bigint, liquidity: bigint, amount0Max: bigint, amount1Max: bigint, hookData: Hex = "0x"): Hex {
  return encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint128" },
      { type: "uint128" },
      { type: "bytes" },
    ],
    [tokenId, liquidity, amount0Max, amount1Max, hookData],
  );
}

function decreaseParams(tokenId: bigint, liquidity: bigint, amount0Min: bigint, amount1Min: bigint, hookData: Hex = "0x"): Hex {
  return encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint128" },
      { type: "uint128" },
      { type: "bytes" },
    ],
    [tokenId, liquidity, amount0Min, amount1Min, hookData],
  );
}

function burnParams(tokenId: bigint, amount0Min: bigint, amount1Min: bigint, hookData: Hex = "0x"): Hex {
  return encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes" }],
    [tokenId, amount0Min, amount1Min, hookData],
  );
}

function settlePairParams(currency0: Address, currency1: Address): Hex {
  return encodeAbiParameters([{ type: "address" }, { type: "address" }], [currency0, currency1]);
}

function takePairParams(currency0: Address, currency1: Address, recipient: Address): Hex {
  return encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }],
    [currency0, currency1, getAddress(recipient)],
  );
}

function sweepParams(currency: Address, recipient: Address): Hex {
  return encodeAbiParameters([{ type: "address" }, { type: "address" }], [currency, getAddress(recipient)]);
}

function pmTx(data: Hex, value: bigint, description: string, chainId = 8453): PlannedTx {
  return { to: addressesFor(slugForChainId(chainId)).v4PositionManager, data, value, description };
}

export function v4MintTx(args: {
  poolKey: V4PoolKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
  recipient: Address;
  slippageBps?: number;
  deadlineSec?: number;
  hookData?: Hex;
  chainId?: number;
}): PlannedTx {
  if (args.poolKey.hooks.toLowerCase() !== ADDRESSES.nativeEth.toLowerCase()) {
    throw new Error(`Refuse unknown v4 hooks ${args.poolKey.hooks}`);
  }
  const bps = args.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const amount0Max = slipMax(args.amount0, bps);
  const amount1Max = slipMax(args.amount1, bps);
  const c0 = args.poolKey.currency0;
  const c1 = args.poolKey.currency1;
  const native0 = c0.toLowerCase() === ADDRESSES.nativeEth.toLowerCase();
  const native1 = c1.toLowerCase() === ADDRESSES.nativeEth.toLowerCase();
  const actions: number[] = [V4_ACTIONS.MINT_POSITION, V4_ACTIONS.SETTLE_PAIR];
  const params = [
    mintParams({
      poolKey: args.poolKey,
      tickLower: args.tickLower,
      tickUpper: args.tickUpper,
      liquidity: args.liquidity,
      amount0Max,
      amount1Max,
      recipient: args.recipient,
      hookData: args.hookData,
    }),
    settlePairParams(c0, c1),
  ];
  if (native0 || native1) {
    actions.push(V4_ACTIONS.SWEEP);
    params.push(sweepParams(ADDRESSES.nativeEth, args.recipient));
  }
  const value = native0 ? args.amount0 : native1 ? args.amount1 : 0n;
  return pmTx(encodeModifyLiquidities(actions, params, args.deadlineSec), value, "PositionManager.modifyLiquidities mint", args.chainId);
}

export function v4IncreaseTx(
  position: PositionSnapshot,
  liquidity: bigint,
  amount0: bigint,
  amount1: bigint,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
): PlannedTx {
  const key = poolKeyFromPosition(position);
  const actions = [V4_ACTIONS.INCREASE_LIQUIDITY, V4_ACTIONS.SETTLE_PAIR];
  const params = [
    increaseParams(position.ref.tokenId, liquidity, slipMax(amount0, slippageBps), slipMax(amount1, slippageBps)),
    settlePairParams(key.currency0, key.currency1),
  ];
  const native0 = key.currency0.toLowerCase() === ADDRESSES.nativeEth.toLowerCase();
  const native1 = key.currency1.toLowerCase() === ADDRESSES.nativeEth.toLowerCase();
  const value = native0 ? amount0 : native1 ? amount1 : 0n;
  return pmTx(encodeModifyLiquidities(actions, params), value, "PositionManager.modifyLiquidities increase", position.ref.chainId);
}

export function v4DecreaseTx(
  position: PositionSnapshot,
  liquidity: bigint,
  recipient: Address,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
): PlannedTx {
  const key = poolKeyFromPosition(position);
  const actions = [V4_ACTIONS.DECREASE_LIQUIDITY, V4_ACTIONS.TAKE_PAIR];
  const params = [
    decreaseParams(position.ref.tokenId, liquidity, slipMin(position.amount0, slippageBps), slipMin(position.amount1, slippageBps)),
    takePairParams(key.currency0, key.currency1, recipient),
  ];
  return pmTx(encodeModifyLiquidities(actions, params), 0n, "PositionManager.modifyLiquidities decrease", position.ref.chainId);
}

/** Official v4 claim: zero-liquidity decrease + TAKE_PAIR. */
export function v4ClaimFeesTx(position: PositionSnapshot, recipient: Address): PlannedTx {
  const key = poolKeyFromPosition(position);
  const actions = [V4_ACTIONS.DECREASE_LIQUIDITY, V4_ACTIONS.TAKE_PAIR];
  const params = [
    decreaseParams(position.ref.tokenId, 0n, 0n, 0n),
    takePairParams(key.currency0, key.currency1, recipient),
  ];
  return pmTx(encodeModifyLiquidities(actions, params), 0n, "PositionManager.modifyLiquidities claim (0-liq decrease)", position.ref.chainId);
}

export function v4BurnTx(position: PositionSnapshot, recipient: Address, slippageBps = DEFAULT_SLIPPAGE_BPS): PlannedTx {
  const key = poolKeyFromPosition(position);
  const actions = [V4_ACTIONS.BURN_POSITION, V4_ACTIONS.TAKE_PAIR];
  const params = [
    burnParams(position.ref.tokenId, slipMin(position.amount0, slippageBps), slipMin(position.amount1, slippageBps)),
    takePairParams(key.currency0, key.currency1, recipient),
  ];
  return pmTx(encodeModifyLiquidities(actions, params), 0n, "PositionManager.modifyLiquidities burn", position.ref.chainId);
}

export function permit2ApproveTx(
  token: Address,
  spender: Address,
  amount: bigint,
  expirationSec = DEFAULT_DEADLINE_SEC,
  chainId = 8453,
): PlannedTx {
  const expiration = Math.floor(Date.now() / 1000) + expirationSec;
  return {
    to: addressesFor(slugForChainId(chainId)).permit2,
    data: encodeFunctionData({
      abi: permit2Abi,
      functionName: "approve",
      args: [getAddress(token), getAddress(spender), amount, expiration],
    }),
    value: 0n,
    description: `Permit2.approve ${spender}`,
  };
}
