import type { Address } from "viem";
import { Token } from "@uniswap/sdk-core";
import { Pool, Position } from "@uniswap/v3-sdk";
import { TREASURY, CHAIN_ID } from "../constants.js";
import { collectCalldata, decreaseCalldata, erc20TransferTx, increaseCalldata, mintCalldata } from "../uniswap/calldata.js";
import { v2AddFromPosition, v2RemoveFromPosition } from "../uniswap/v2-calldata.js";
import { poolKeyFromPosition, v4BurnTx, v4ClaimFeesTx, v4DecreaseTx, v4IncreaseTx, v4MintTx } from "../uniswap/v4-calldata.js";
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

function liquidityForAmounts(position: PositionSnapshot, add0: bigint, add1: bigint, tickLower = position.tickLower, tickUpper = position.tickUpper): bigint {
  if (add0 === 0n && add1 === 0n) return 0n;
  const t0 = new Token(CHAIN_ID, position.token0.address, position.token0.decimals, position.token0.symbol);
  const t1 = new Token(CHAIN_ID, position.token1.address, position.token1.decimals, position.token1.symbol);
  const pool = new Pool(t0, t1, position.fee, position.sqrtPriceX96.toString(), "0", position.tickCurrent);
  const next = Position.fromAmounts({
    pool,
    tickLower,
    tickUpper,
    amount0: add0.toString(),
    amount1: add1.toString(),
    useFullPrecision: false,
  });
  return BigInt(next.liquidity.toString());
}

/** Replace placeholder 0x txs with protocol calldata (v2 Router02 / v3 NFPM / v4 PositionManager). Never attach a 0-min-out swap. */
export function hydrateCalldata(receipt: ActionReceipt, position: PositionSnapshot, owner: Address): ActionReceipt {
  if (receipt.skipped) return receipt;
  const includePrincipal = receipt.action === "rerange" || receipt.action === "exit";
  const available = availableAfterUnwind(position, includePrincipal);
  const leftover = receipt.treasuryFee
    ? netAfterTake(available.amount0, available.amount1, receipt.treasuryFee.amount0, receipt.treasuryFee.amount1)
    : available;

  const protocol = position.ref.protocol;

  const actions = receipt.actions.map((action) => {
    if (isFilled(action.tx)) return action;
    if (action.kind === "collect") {
      if (protocol === "V2") return { ...action, tx: undefined };
      if (protocol === "V4") return { ...action, tx: v4ClaimFeesTx(position, owner) };
      return { ...action, tx: collectCalldata(position, owner) };
    }
    if (action.kind === "increase") {
      if (protocol === "V2") return { ...action, tx: v2AddFromPosition(position, leftover.amount0, leftover.amount1, owner) };
      if (protocol === "V4") {
        return { ...action, tx: v4IncreaseTx(position, liquidityForAmounts(position, leftover.amount0, leftover.amount1), leftover.amount0, leftover.amount1) };
      }
      return { ...action, tx: increaseCalldata(position, leftover.amount0, leftover.amount1) };
    }
    if (action.kind === "decrease") {
      if (protocol === "V2") return { ...action, tx: v2RemoveFromPosition(position, owner, 100) };
      if (protocol === "V4") return { ...action, tx: v4DecreaseTx(position, position.liquidity, owner) };
      return { ...action, tx: decreaseCalldata(position, 100, owner) };
    }
    if (action.kind === "mint") {
      const next = recenterSameWidth(
        position.tickLower,
        position.tickUpper,
        position.tickCurrent,
        position.tickSpacing,
      );
      if (protocol === "V2") return { ...action, tx: v2AddFromPosition(position, leftover.amount0, leftover.amount1, owner) };
      if (protocol === "V4") {
        return {
          ...action,
          tx: v4MintTx({
            poolKey: poolKeyFromPosition(position),
            tickLower: next.tickLower,
            tickUpper: next.tickUpper,
            liquidity: liquidityForAmounts(position, leftover.amount0, leftover.amount1, next.tickLower, next.tickUpper),
            amount0: leftover.amount0,
            amount1: leftover.amount1,
            recipient: owner,
          }),
        };
      }
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
    if (action.kind === "burn") {
      if (protocol === "V2") return { ...action, tx: undefined };
      if (protocol === "V4") return { ...action, tx: v4BurnTx(position, owner) };
      return action;
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

export async function hydrateCalldataMaybeApi(
  receipt: ActionReceipt,
  position: PositionSnapshot,
  owner: Address,
  apiKey?: string,
): Promise<ActionReceipt> {
  const local = hydrateCalldata(receipt, position, owner);
  if (!apiKey || local.skipped) return local;
  try {
    const { tryLpWrite } = await import("./mint-flow.js");
    const protocol = position.ref.protocol;
    const actions = [];
    for (const action of local.actions) {
      if (action.kind === "collect" && protocol !== "V2") {
        const tx = await tryLpWrite({
          apiKey,
          protocol,
          owner,
          action: "claim",
          token0: position.token0.address,
          token1: position.token1.address,
          tokenId: position.ref.tokenId,
        });
        actions.push(tx ? { ...action, tx } : action);
        continue;
      }
      if (action.kind === "increase") {
        const independent = (action.amountIn ?? 0n) > 0n
          ? { tokenAddress: position.token0.address, amount: String(action.amountIn) }
          : { tokenAddress: position.token1.address, amount: String(action.amountOut ?? 0n) };
        const tx = await tryLpWrite({
          apiKey,
          protocol,
          owner,
          action: "increase",
          token0: position.token0.address,
          token1: position.token1.address,
          tokenId: position.ref.tokenId,
          independent,
        });
        actions.push(tx ? { ...action, tx } : action);
        continue;
      }
      if (action.kind === "decrease") {
        const tx = await tryLpWrite({
          apiKey,
          protocol,
          owner,
          action: "decrease",
          token0: position.token0.address,
          token1: position.token1.address,
          tokenId: position.ref.tokenId,
          pct: 100,
        });
        actions.push(tx ? { ...action, tx } : action);
        continue;
      }
      actions.push(action);
    }
    return {
      ...local,
      actions,
      txs: actions.map((a) => a.tx).filter((tx): tx is NonNullable<typeof tx> => Boolean(tx)),
    };
  } catch {
    return local;
  }
}
