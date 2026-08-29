import type { Address } from "viem";
import { TREASURY } from "../constants.js";
import { collectCalldata, decreaseCalldata, erc20TransferTx, increaseCalldata, mintCalldata } from "../uniswap/calldata.js";
import { exactInV3Tx } from "../uniswap/router.js";
import { netAfterTake } from "./fees.js";
import { recenterSameWidth } from "./ticks.js";
import type { ActionReceipt, PositionSnapshot } from "../types.js";

/** Replace placeholder 0x txs with v3-sdk / UR calldata. */
export function hydrateCalldata(receipt: ActionReceipt, position: PositionSnapshot, owner: Address): ActionReceipt {
  if (receipt.skipped) return receipt;
  const leftover = receipt.treasuryFee
    ? netAfterTake(
        position.uncollected0,
        position.uncollected1,
        receipt.treasuryFee.amount0,
        receipt.treasuryFee.amount1,
      )
    : { amount0: position.uncollected0, amount1: position.uncollected1 };

  const actions = receipt.actions.map((action) => {
    if (action.kind === "collect") {
      return { ...action, tx: collectCalldata(position, owner) };
    }
    if (action.kind === "increase") {
      return { ...action, tx: increaseCalldata(position, leftover.amount0, leftover.amount1) };
    }
    if (action.kind === "decrease") {
      return { ...action, tx: decreaseCalldata(position, 100, owner) };
    }
    if (action.kind === "mint") {
      const next = recenterSameWidth(
        position.tickLower,
        position.tickUpper,
        position.tickCurrent,
        position.tickSpacing,
      );
      return {
        ...action,
        tx: mintCalldata({
          position,
          tickLower: next.tickLower,
          tickUpper: next.tickUpper,
          amount0: leftover.amount0 + position.amount0,
          amount1: leftover.amount1 + position.amount1,
          recipient: owner,
        }),
      };
    }
    if (action.kind === "transfer" && action.recipient === (receipt.treasuryFee?.recipient ?? TREASURY) && action.tokenIn && action.amountIn) {
      return { ...action, tx: erc20TransferTx(action.tokenIn, action.recipient, action.amountIn) };
    }
    if (action.kind === "swap" && action.tokenOut) {
      const tokenIn = position.token0.address === action.tokenOut ? position.token1.address : position.token0.address;
      const amountIn = position.token0.address === tokenIn ? leftover.amount0 : leftover.amount1;
      return {
        ...action,
        tx: exactInV3Tx({
          tokenIn,
          tokenOut: action.tokenOut,
          fee: position.fee,
          amountIn,
          amountOutMin: 0n,
          recipient: owner,
        }),
      };
    }
    return action;
  });

  return {
    ...receipt,
    actions,
    txs: actions.map((a) => a.tx).filter((tx): tx is NonNullable<typeof tx> => Boolean(tx)),
  };
}
