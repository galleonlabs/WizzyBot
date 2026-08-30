import { encodeFunctionData, type Address } from "viem";
import { CHAIN_ID } from "../constants.js";
import { addressesFor, slugForChainId } from "../chains.js";
import type { PlannedTx } from "../types.js";

const SWAP_ROUTER_02_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [{
      name: "params",
      type: "tuple",
      components: [
        { name: "tokenIn", type: "address" },
        { name: "tokenOut", type: "address" },
        { name: "fee", type: "uint24" },
        { name: "recipient", type: "address" },
        { name: "amountIn", type: "uint256" },
        { name: "amountOutMinimum", type: "uint256" },
        { name: "sqrtPriceLimitX96", type: "uint160" },
      ],
    }],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

/**
 * Single-hop v3 exact-in via SwapRouter02.
 *
 * Robinhood's deployed Universal Router rejects the standard v3 command with
 * SliceOutOfBounds, while its canonical SwapRouter02 executes the same pool
 * route. Use the direct router on every supported EVM chain so quotes are
 * executable instead of merely structurally valid.
 * Rebalance swaps pay the DEX pool fee only — Wizzy adds no swap take.
 */
export function exactInV3Tx(args: {
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  amountIn: bigint;
  amountOutMin: bigint;
  recipient: Address;
  payerIsUser?: boolean;
  deadlineSec?: number;
  chainId?: number;
}): PlannedTx {
  const data = encodeFunctionData({
    abi: SWAP_ROUTER_02_ABI,
    functionName: "exactInputSingle",
    args: [{
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      fee: args.fee,
      recipient: args.recipient,
      amountIn: args.amountIn,
      amountOutMinimum: args.amountOutMin,
      sqrtPriceLimitX96: 0n,
    }],
  });
  const addresses = addressesFor(slugForChainId(args.chainId ?? CHAIN_ID));
  return {
    to: addresses.swapRouter02,
    data,
    value: 0n,
    description: `UR v3 exact-in ${args.tokenIn} → ${args.tokenOut}`,
  };
}
