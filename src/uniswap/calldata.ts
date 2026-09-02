import { Percent, Token, CurrencyAmount, Ether } from "@uniswap/sdk-core";
import { NonfungiblePositionManager, Pool, Position } from "@uniswap/v3-sdk";
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { ADDRESSES, CHAIN_ID, DEFAULT_DEADLINE_SEC, DEFAULT_SLIPPAGE_BPS } from "../constants.js";
import { addressesFor, slugForChainId } from "../chains.js";
import { erc20Abi, wethAbi } from "../chain/abi.js";
import type { PlannedTx, PositionSnapshot } from "../types.js";

function slippage(bps: number): Percent {
  return new Percent(bps, 10_000);
}

function sdkPool(position: PositionSnapshot): Pool {
  const t0 = new Token(position.ref.chainId ?? CHAIN_ID, position.token0.address, position.token0.decimals, position.token0.symbol);
  const t1 = new Token(position.ref.chainId ?? CHAIN_ID, position.token1.address, position.token1.decimals, position.token1.symbol);
  return new Pool(
    t0,
    t1,
    position.fee,
    position.sqrtPriceX96.toString(),
    "0",
    position.tickCurrent,
  );
}

function sdkPosition(position: PositionSnapshot, liquidity = position.liquidity): Position {
  return new Position({
    pool: sdkPool(position),
    liquidity: liquidity.toString(),
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
  });
}

export function collectCalldata(
  position: PositionSnapshot,
  recipient: Address,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
): PlannedTx {
  const owed0 = CurrencyAmount.fromRawAmount(
    sdkPool(position).token0,
    position.uncollected0.toString(),
  );
  const owed1 = CurrencyAmount.fromRawAmount(
    sdkPool(position).token1,
    position.uncollected1.toString(),
  );
  const { calldata, value } = NonfungiblePositionManager.collectCallParameters({
    tokenId: position.ref.tokenId.toString(),
    expectedCurrencyOwed0: owed0,
    expectedCurrencyOwed1: owed1,
    recipient,
  });
  void slippageBps;
  return {
    to: addressesFor(slugForChainId(position.ref.chainId)).nfpm,
    data: calldata as Hex,
    value: BigInt(value),
    description: "NFPM.collect",
  };
}

export function increaseCalldata(
  position: PositionSnapshot,
  add0: bigint,
  add1: bigint,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
  deadlineSec = DEFAULT_DEADLINE_SEC,
  useNative = false,
): PlannedTx {
  const pool = sdkPool(position);
  const next = Position.fromAmounts({
    pool,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    amount0: add0.toString(),
    amount1: add1.toString(),
    useFullPrecision: false,
  });
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(next, {
    tokenId: position.ref.tokenId.toString(),
    slippageTolerance: slippage(slippageBps),
    deadline: Math.floor(Date.now() / 1000) + deadlineSec,
    useNative: useNative ? Ether.onChain(position.ref.chainId ?? CHAIN_ID) : undefined,
  });
  return {
    to: addressesFor(slugForChainId(position.ref.chainId)).nfpm,
    data: calldata as Hex,
    value: BigInt(value),
    description: "NFPM.increaseLiquidity",
  };
}

export function mintCalldata(args: {
  position: PositionSnapshot;
  tickLower: number;
  tickUpper: number;
  amount0: bigint;
  amount1: bigint;
  recipient: Address;
  slippageBps?: number;
  deadlineSec?: number;
  useNative?: boolean;
}): PlannedTx {
  const pool = sdkPool(args.position);
  const minted = Position.fromAmounts({
    pool,
    tickLower: args.tickLower,
    tickUpper: args.tickUpper,
    amount0: args.amount0.toString(),
    amount1: args.amount1.toString(),
    useFullPrecision: false,
  });
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(minted, {
    recipient: args.recipient,
    slippageTolerance: slippage(args.slippageBps ?? DEFAULT_SLIPPAGE_BPS),
    deadline: Math.floor(Date.now() / 1000) + (args.deadlineSec ?? DEFAULT_DEADLINE_SEC),
    useNative: args.useNative ? Ether.onChain(args.position.ref.chainId ?? CHAIN_ID) : undefined,
  });
  return {
    to: addressesFor(slugForChainId(args.position.ref.chainId)).nfpm,
    data: calldata as Hex,
    value: BigInt(value),
    description: "NFPM.mint",
  };
}

export function decreaseCalldata(
  position: PositionSnapshot,
  pct: number,
  recipient: Address,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
  deadlineSec = DEFAULT_DEADLINE_SEC,
  burnToken = false,
): PlannedTx {
  const sdkPos = sdkPosition(position);
  const { calldata, value } = NonfungiblePositionManager.removeCallParameters(sdkPos, {
    tokenId: position.ref.tokenId.toString(),
    liquidityPercentage: new Percent(Math.round(pct), 100),
    slippageTolerance: slippage(slippageBps),
    deadline: Math.floor(Date.now() / 1000) + deadlineSec,
    burnToken,
    collectOptions: {
      expectedCurrencyOwed0: CurrencyAmount.fromRawAmount(sdkPos.pool.token0, position.uncollected0.toString()),
      expectedCurrencyOwed1: CurrencyAmount.fromRawAmount(sdkPos.pool.token1, position.uncollected1.toString()),
      recipient,
    },
  });
  return {
    to: addressesFor(slugForChainId(position.ref.chainId)).nfpm,
    data: calldata as Hex,
    value: BigInt(value),
    description: `NFPM.decreaseLiquidity ${pct}%`,
  };
}

export function erc20TransferTx(token: Address, to: Address, amount: bigint): PlannedTx {
  return {
    to: getAddress(token),
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [getAddress(to), amount],
    }),
    value: 0n,
    description: `ERC20.transfer ${amount} → ${to}`,
  };
}

export function erc20ApproveTx(token: Address, spender: Address, amount: bigint): PlannedTx {
  return {
    to: getAddress(token),
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [getAddress(spender), amount],
    }),
    value: 0n,
    description: `ERC20.approve ${spender}`,
  };
}

export function wrapEthTx(amount: bigint, chainId: number = CHAIN_ID): PlannedTx {
  return {
    to: addressesFor(slugForChainId(chainId)).weth,
    data: encodeFunctionData({
      abi: wethAbi,
      functionName: "deposit",
    }),
    value: amount,
    description: `WETH.deposit ${amount}`,
  };
}

export function unwrapEthTx(amount: bigint, chainId: number = CHAIN_ID): PlannedTx {
  return {
    to: addressesFor(slugForChainId(chainId)).weth,
    data: encodeFunctionData({
      abi: wethAbi,
      functionName: "withdraw",
      args: [amount],
    }),
    value: 0n,
    description: `WETH.withdraw ${amount}`,
  };
}

export function nativeTransferTx(to: Address, amount: bigint): PlannedTx {
  return {
    to: getAddress(to),
    data: "0x",
    value: amount,
    description: `native transfer ${amount} → ${to}`,
  };
}
