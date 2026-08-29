import type { Address } from "viem";
import { TREASURY } from "../constants.js";
import { collectCalldata, decreaseCalldata, erc20TransferTx, increaseCalldata, mintCalldata } from "../uniswap/calldata.js";
import { netAfterTake } from "./fees.js";
import { recenterSameWidth } from "./ticks.js";
import type { ActionReceipt, PlannedTx, PositionSnapshot } from "../types.js";

function isFilled(tx: PlannedTx | undefined): boolean {
  return Boolean(tx?.data && tx.data !== "0x" && tx.data !== "0x0");
}

/** Tokens sitting in the wallet after the planned collect (and decrease, for unwind). */
export function availableAfterUnwind(
  position: PositionSnapshot,
  includePrincipal: boolean,
): { amount0: bigint; amount1: bigint } {
  if (includePrincipal) {
    return {
      amount0: position.amount0 + position.uncollected0,
      amount1: position.amount1 + position.uncollected1,
    };
  }
  return { amount0: position.uncollected0, amount1: position.uncollected1 };
}

/** Replace placeholder 0x txs with v3-sdk / UR calldata. Never attach a 0-min-out swap. */
export function hydrateCalldata(receipt: ActionReceipt, position: PositionSnapshot, owner: Address): ActionReceipt {
  if (receipt.skipped) return receipt;
  const includePrincipal = receipt.action === "rerange" || receipt.action === "exit";
  const available = availableAfterUnwind(position, includePrincipal);
  const leftover = receipt.treasuryFee
    ? netAfterTake(available.amount0, available.amount1, receipt.treasuryFee.amount0, receipt.treasuryFee.amount1)
    : available;

  const actions = receipt.actions.map((action) => {
    if (isFilled(action.tx)) return action;
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
          amount0: leftover.amount0,
          amount1: leftover.amount1,
          recipient: owner,
        }),
      };
    }
    if (action.kind === "transfer" && action.recipient === (receipt.treasuryFee?.recipient ?? TREASURY) && action.tokenIn && action.amountIn) {
      return { ...action, tx: erc20TransferTx(action.tokenIn, action.recipient, action.amountIn) };
    }
    if (action.kind === "swap") {
      // Do not build exact-in with amountOutMin=0 (sandwich). Live path skips placeholder calldata.
      return action;
    }
    return action;
  });

  return {
    ...receipt,
    actions,
    txs: actions.map((a) => a.tx).filter((tx): tx is NonNullable<typeof tx> => Boolean(tx)),
  };
}
