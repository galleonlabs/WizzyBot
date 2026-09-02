import { getAddress, type Address } from "viem";
import { addressesFor, slugForChainId } from "../chains.js";
import { writeTarget } from "./protocol.js";
import { v2ApprovePairTx } from "../uniswap/v2-calldata.js";
import type {
  ActionReceipt,
  FeeSource,
  PlannedAction,
  PlannedTx,
  PositionSnapshot,
} from "../types.js";
import { evaluateEconomics } from "./economics.js";
import { recenterSameWidth } from "./ticks.js";
import { shouldExitAtPrice, shouldRerange } from "./range.js";

export interface PlanContext {
  owner: Address;
  dryRun: boolean;
  noFee: boolean;
  feeSource: FeeSource;
  minFeeUsd: number;
  minPositionUsd: number;
  feesUsd: number;
  notionalUsd: number;
  gasUsd: number;
  takeBps: number;
  takeBaseUsd?: number;
}

function collectAction(position: PositionSnapshot, recipient: Address): PlannedAction {
  return {
    kind: "collect",
    description: `collect uncollected fees tokenId=${position.ref.tokenId}`,
    amountIn: position.uncollected0,
    amountOut: position.uncollected1,
    recipient,
    tx: {
      to: writeTarget(position.ref.protocol, position.ref.chainId),
      data: "0x",
      value: 0n,
      description: position.ref.protocol === "V4" ? "PositionManager.modifyLiquidities claim (0-liq decrease)" : "NFPM.collect",
    },
  };
}

export function planCompound(
  position: PositionSnapshot,
  ctx: PlanContext,
  opts: { skipSwap?: boolean } = {},
): ActionReceipt {
  if (position.ref.protocol === "V2") {
    return {
      action: "compound",
      dryRun: ctx.dryRun,
      skipped: true,
      reason: "v2 fees are embedded in the LP token; decrease to realize. No claim_fees.",
      tokenId: position.ref.tokenId,
      from: ctx.owner,
      to: [],
      actions: [],
      treasuryFee: null,
      txs: [],
    };
  }
  const econ = evaluateEconomics({
    feesUsd: ctx.feesUsd,
    notionalUsd: ctx.notionalUsd,
    gasUsd: ctx.gasUsd,
    minFeeUsd: ctx.minFeeUsd,
    minPositionUsd: ctx.minPositionUsd,
    takeBps: 0,
    noFee: true,
    takeBaseUsd: ctx.takeBaseUsd,
  });

  if (econ.skip) {
    return {
      action: "compound",
      dryRun: ctx.dryRun,
      skipped: true,
      reason: econ.reason,
      tokenId: position.ref.tokenId,
      from: ctx.owner,
      to: [],
      actions: [],
      treasuryFee: null,
      txs: [],
    };
  }

  const leftover = {
    amount0: position.uncollected0,
    amount1: position.uncollected1,
  };

  const actions: PlannedAction[] = [collectAction(position, ctx.owner)];

  if (!opts.skipSwap && leftover.amount0 > 0n && leftover.amount1 > 0n) {
    actions.push({
      kind: "swap",
      description: "optional swap leftover fees toward in-range ratio (DEX pool fee only)",
      tx: {
        to: addressesFor(slugForChainId(position.ref.chainId)).universalRouter,
        data: "0x",
        value: 0n,
        description: "Universal Router v3 exact-in (no Wizzy swap fee)",
      },
    });
  }

  actions.push({
    kind: "increase",
    description: `increase liquidity tokenId=${position.ref.tokenId}`,
    amountIn: leftover.amount0,
    amountOut: leftover.amount1,
    tx: {
      to: addressesFor(slugForChainId(position.ref.chainId)).nfpm,
      data: "0x",
      value: 0n,
      description: "NFPM.increaseLiquidity",
    },
  });

  return receipt("compound", position, ctx, actions);
}

export function planRerange(
  position: PositionSnapshot,
  ctx: PlanContext,
  opts: { oorPercent: number },
): ActionReceipt {
  if (position.ref.protocol === "V2") {
    return {
      action: "rerange",
      dryRun: ctx.dryRun,
      skipped: true,
      reason: "v2 is full-range only; range is a no-op",
      tokenId: position.ref.tokenId,
      from: ctx.owner,
      to: [],
      actions: [],
      treasuryFee: null,
      txs: [],
    };
  }
  const fire = shouldRerange({
    tickCurrent: position.tickCurrent,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    oorPercent: opts.oorPercent,
  });

  if (!fire) {
    return {
      action: "rerange",
      dryRun: ctx.dryRun,
      skipped: true,
      reason: `in range (${position.tickLower}, ${position.tickUpper}) tick=${position.tickCurrent} oorPercent=${opts.oorPercent}`,
      tokenId: position.ref.tokenId,
      from: ctx.owner,
      to: [],
      actions: [],
      treasuryFee: null,
      txs: [],
    };
  }

  const econ = evaluateEconomics({
    feesUsd: ctx.feesUsd,
    notionalUsd: ctx.notionalUsd,
    gasUsd: ctx.gasUsd,
    minFeeUsd: ctx.minFeeUsd,
    minPositionUsd: ctx.minPositionUsd,
    takeBps: 0,
    noFee: true,
    takeBaseUsd: ctx.takeBaseUsd,
  });

  if (econ.skip && econ.reason?.startsWith("size floor")) {
    return {
      action: "rerange",
      dryRun: ctx.dryRun,
      skipped: true,
      reason: econ.reason,
      tokenId: position.ref.tokenId,
      from: ctx.owner,
      to: [],
      actions: [],
      treasuryFee: null,
      txs: [],
    };
  }

  const nextRange = recenterSameWidth(
    position.tickLower,
    position.tickUpper,
    position.tickCurrent,
    position.tickSpacing,
  );

  const actions: PlannedAction[] = [
    {
      kind: "decrease",
      description: `decrease 100% tokenId=${position.ref.tokenId}`,
      tx: {
        to: writeTarget(position.ref.protocol, position.ref.chainId),
        data: "0x",
        value: 0n,
        description: position.ref.protocol === "V4" ? "PositionManager.modifyLiquidities decrease" : "NFPM.decreaseLiquidity 100%",
      },
    },
    collectAction(position, ctx.owner),
    {
      kind: "mint",
      description: `mint same-width recenter ticks [${nextRange.tickLower}, ${nextRange.tickUpper}]`,
      tx: {
        to: writeTarget(position.ref.protocol, position.ref.chainId),
        data: "0x",
        value: 0n,
        description: position.ref.protocol === "V4" ? "PositionManager.modifyLiquidities mint" : "NFPM.mint",
      },
    },
    {
      kind: "transfer",
      description: "leftover tokens returned to owner (no vault custody)",
      recipient: ctx.owner,
    },
  ];

  const built = receipt("rerange", position, ctx, actions);
  return built;
}

export function planExit(
  position: PositionSnapshot,
  ctx: PlanContext,
  opts: {
    exitPrice?: number;
    currentPrice?: number;
    above?: boolean;
    swapTo?: Address;
  } = {},
): ActionReceipt {
  if (opts.exitPrice !== undefined && opts.currentPrice !== undefined) {
    const fire = shouldExitAtPrice({
      currentPrice: opts.currentPrice,
      exitPrice: opts.exitPrice,
      above: opts.above ?? opts.currentPrice >= opts.exitPrice,
    });
    if (!fire) {
      return {
        action: "exit",
        dryRun: ctx.dryRun,
        skipped: true,
        reason: `exit price not reached: current=${opts.currentPrice} target=${opts.exitPrice}`,
        tokenId: position.ref.tokenId,
        from: ctx.owner,
        to: [],
        actions: [],
        treasuryFee: null,
        txs: [],
      };
    }
  }

  if (position.ref.protocol === "V2") {
    const actions: PlannedAction[] = [
      {
        kind: "approve",
        description: `approve Router02 for v2 LP token ${position.pool}`,
        tokenIn: position.pool,
        amountIn: position.liquidity,
        tx: v2ApprovePairTx(position.pool, position.liquidity, position.ref.chainId),
      },
      {
        kind: "decrease",
        description: `remove 100% v2 liquidity pair=${position.pool}`,
        tx: {
          to: addressesFor(slugForChainId(position.ref.chainId)).v2Router,
          data: "0x",
          value: 0n,
          description: "Router02.removeLiquidity",
        },
      },
    ];
    return receipt("exit", position, ctx, actions);
  }

  const actions: PlannedAction[] = [
    {
      kind: "decrease",
      description: `decrease 100% tokenId=${position.ref.tokenId}`,
      tx: {
        to: writeTarget(position.ref.protocol, position.ref.chainId),
        data: "0x",
        value: 0n,
        description: position.ref.protocol === "V4" ? "PositionManager.modifyLiquidities decrease" : "NFPM.decreaseLiquidity 100%",
      },
    },
    collectAction(position, ctx.owner),
  ];

  if (opts.swapTo) {
    const dest = getAddress(opts.swapTo);
    actions.push({
      kind: "swap",
      description: `optional exit swap to ${dest} (DEX pool fee only)`,
      tokenOut: dest,
      recipient: ctx.owner,
      tx: {
        to: addressesFor(slugForChainId(position.ref.chainId)).universalRouter,
        data: "0x",
        value: 0n,
        description: "Universal Router v3 exact-in",
      },
    });
  }

  actions.push({
    kind: "burn",
    description: `burn empty NFT tokenId=${position.ref.tokenId}`,
    tx: {
      to: addressesFor(slugForChainId(position.ref.chainId)).nfpm,
      data: "0x",
      value: 0n,
      description: "NFPM.burn",
    },
  });

  return receipt("exit", position, ctx, actions);
}

function receipt(
  action: ActionReceipt["action"],
  position: PositionSnapshot,
  ctx: PlanContext,
  actions: PlannedAction[],
): ActionReceipt {
  const txs: PlannedTx[] = actions
    .map((a) => a.tx)
    .filter((tx): tx is PlannedTx => Boolean(tx));
  return {
    action,
    dryRun: ctx.dryRun,
    skipped: false,
    tokenId: position.ref.tokenId,
    from: ctx.owner,
    to: [writeTarget(position.ref.protocol, position.ref.chainId), ctx.owner],
    actions,
    treasuryFee: null,
    txs,
  };
}

export function formatReceipt(receipt: ActionReceipt): string {
  const lines = [
    `action=${receipt.action} dryRun=${receipt.dryRun} skipped=${receipt.skipped}`,
    receipt.reason ? `reason=${receipt.reason}` : undefined,
    receipt.tokenId !== undefined ? `tokenId=${receipt.tokenId}` : undefined,
    `from=${receipt.from}`,
    `to=${receipt.to.join(",")}`,
    receipt.treasuryFee
      ? `treasuryFee source=${receipt.treasuryFee.source} bps=${receipt.treasuryFee.bps} skipped=${receipt.treasuryFee.skipped} recipient=${receipt.treasuryFee.recipient} amount0=${receipt.treasuryFee.amount0} amount1=${receipt.treasuryFee.amount1}`
      : "treasuryFee=null",
    ...receipt.actions.map((a, i) => `  ${i + 1}. ${a.kind}: ${a.description}`),
  ];
  return lines.filter(Boolean).join("\n");
}
