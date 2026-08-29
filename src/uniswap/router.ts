import { concatHex, encodeAbiParameters, encodeFunctionData, padHex, toHex, type Address, type Hex } from "viem";
import { CHAIN_ID } from "../constants.js";
import { addressesFor, slugForChainId } from "../chains.js";
import type { PlannedTx } from "../types.js";

const UR_ABI = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const V3_SWAP_EXACT_IN = 0x00;

function v3Path(tokenIn: Address, fee: number, tokenOut: Address): Hex {
  const feeHex = padHex(toHex(fee), { size: 3 });
  return concatHex([tokenIn, feeHex, tokenOut]);
}

/**
 * Single-hop v3 exact-in via Universal Router 2.0.
 * Rebalance swaps pay the DEX pool fee only — UnaBot adds no swap take.
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
  const path = v3Path(args.tokenIn, args.fee, args.tokenOut);
  const input = encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bytes" },
      { type: "bool" },
    ],
    [args.recipient, args.amountIn, args.amountOutMin, path, args.payerIsUser ?? true],
  );
  const data = encodeFunctionData({
    abi: UR_ABI,
    functionName: "execute",
    args: [
      toHex(new Uint8Array([V3_SWAP_EXACT_IN])),
      [input],
      BigInt(Math.floor(Date.now() / 1000) + (args.deadlineSec ?? 600)),
    ],
  });
  const addresses = addressesFor(slugForChainId(args.chainId ?? CHAIN_ID));
  return {
    to: addresses.universalRouter,
    data,
    value: 0n,
    description: `UR v3 exact-in ${args.tokenIn} → ${args.tokenOut}`,
  };
}
