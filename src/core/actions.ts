import { getAddress, type Address } from "viem";
import { ADDRESSES } from "../constants.js";
import type {
  ActionReceipt,
  FeeSource,
  PlannedAction,
  PlannedTx,
  PositionSnapshot,
  TreasuryFee,
} from "../types.js";
import { evaluateEconomics } from "./economics.js";
import { netAfterTake, resolveActionFee } from "./fees.js";
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

function recipients(fee: TreasuryFee | null, owner: Address): Address[] {
  const out = new Set<Address>([ADDRESSES.nfpm, owner]);
  if (fee && !fee.skipped && (fee.amount0 > 0n || fee.amount1 > 0n)) {
    out.add(fee.recipient);
  }
  return [...out];
}

function feeTransfers(fee: TreasuryFee | null): PlannedAction[] {
  if (!fee || fee.skipped) return [];
  const actions: PlannedAction[] = [];
  if (fee.amount0 > 0n) {
    actions.push({
      kind: "transfer",
      description: `treasury take ${fee.bps} bps token0`,
      tokenIn: fee.token0,
      amountIn: fee.amount0,
      recipient: fee.recipient,
      tx: {
        to: fee.token0,
        data: "0x",
        value: 0n,
        description: `ERC20 transfer token0 → treasury ${fee.recipient}`,
      },
    });
  }
  if (fee.amount1 > 0n) {
    actions.push({
      kind: "transfer",
      description: `treasury take ${fee.bps} bps token1`,
      tokenIn: fee.token1,
      amountIn: fee.amount1,
      recipient: fee.recipient,
      tx: {
        to: fee.token1,
        data: "0x",
        value: 0n,
        description: `ERC20 transfer token1 → treasury ${fee.recipient}`,
      },
    });
  }
  return actions;
}

function collectAction(position: PositionSnapshot, recipient: Address): PlannedAction {
  return {
    kind: "collect",
    description: `collect uncollected fees tokenId=${position.ref.tokenId}`,
    amountIn: position.uncollected0,
    amountOut: position.uncollected1,
    recipient,
    tx: {
      to: ADDRESSES.nfpm,
      data: "0x",
      value: 0n,
      description: "NFPM.collect",
    },
  };
}

export function planCompound(
  position: PositionSnapshot,
  ctx: PlanContext,
  opts: { skipSwap?: boolean } = {},
): ActionReceipt {
  const econ = evaluateEconomics({
    feesUsd: ctx.feesUsd,
    notionalUsd: ctx.notionalUsd,
    gasUsd: ctx.gasUsd,
    minFeeUsd: ctx.minFeeUsd,
    minPositionUsd: ctx.minPositionUsd,
    takeBps: ctx.takeBps,
    noFee: ctx.noFee,
    takeBaseUsd: ctx.takeBaseUsd,
  });

  const fee = resolveActionFee({
    action: "compound",
    feeSource: "fees",
    noFee: ctx.noFee,
    uncollected0: position.uncollected0,
    uncollected1: position.uncollected1,
    notional0: position.amount0,
    notional1: position.amount1,
    token0: position.token0.address,
    token1: position.token1.address,
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
      treasuryFee: fee,
      txs: [],
    };
  }

  const leftover = netAfterTake(
    position.uncollected0,
    position.uncollected1,
    fee.amount0,
    fee.amount1,
  );

  const actions: PlannedAction[] = [
    collectAction(position, ctx.owner),
    ...feeTransfers(fee),
  ];

  if (!opts.skipSwap && leftover.amount0 > 0n && leftover.amount1 > 0n) {
    actions.push({
      kind: "swap",
      description: "optional swap leftover fees toward in-range ratio (DEX pool fee only)",
      tx: {
        to: ADDRESSES.universalRouter,
        data: "0x",
        value: 0n,
        description: "Universal Router v3 exact-in (no UnaBot swap fee)",
      },
    });
  }

  actions.push({
    kind: "increase",
    description: `increase liquidity tokenId=${position.ref.tokenId}`,
    amountIn: leftover.amount0,
    amountOut: leftover.amount1,
    tx: {
      to: ADDRESSES.nfpm,
      data: "0x",
      value: 0n,
      description: "NFPM.increaseLiquidity",
    },
  });

  return receipt("compound", position, ctx, actions, fee);
}

export function planRerange(
  position: PositionSnapshot,
  ctx: PlanContext,
  opts: { oorPercent: number },
): ActionReceipt {
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
    takeBps: ctx.takeBps,
    noFee: ctx.noFee,
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

  const fee = resolveActionFee({
    action: "rerange",
    feeSource: ctx.feeSource,
    noFee: ctx.noFee,
    uncollected0: position.uncollected0,
    uncollected1: position.uncollected1,
    notional0: position.amount0,
    notional1: position.amount1,
    token0: position.token0.address,
    token1: position.token1.address,
  });

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
        to: ADDRESSES.nfpm,
        data: "0x",
        value: 0n,
        description: "NFPM.decreaseLiquidity 100%",
      },
    },
    collectAction(position, ctx.owner),
    ...feeTransfers(fee),
    {
      kind: "mint",
      description: `mint same-width recenter ticks [${nextRange.tickLower}, ${nextRange.tickUpper}]`,
      tx: {
        to: ADDRESSES.nfpm,
        data: "0x",
        value: 0n,
        description: "NFPM.mint",
      },
    },
    {
      kind: "transfer",
      description: "leftover tokens returned to owner (no vault custody)",
      recipient: ctx.owner,
    },
  ];

  const built = receipt("rerange", position, ctx, actions, fee);
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

  const fee = resolveActionFee({
    action: "exit",
    feeSource: ctx.feeSource,
    noFee: ctx.noFee,
    uncollected0: position.uncollected0,
    uncollected1: position.uncollected1,
    notional0: position.amount0,
    notional1: position.amount1,
    token0: position.token0.address,
    token1: position.token1.address,
    });

  const actions: PlannedAction[] = [
    {
      kind: "decrease",
      description: `decrease 100% tokenId=${position.ref.tokenId}`,
      tx: {
        to: ADDRESSES.nfpm,
        data: "0x",
        value: 0n,
        description: "NFPM.decreaseLiquidity 100%",
      },
    },
    collectAction(position, ctx.owner),
    ...feeTransfers(fee),
  ];

  if (opts.swapTo) {
    const dest = getAddress(opts.swapTo);
    actions.push({
      kind: "swap",
      description: `optional exit swap to ${dest} (DEX pool fee only)`,
      tokenOut: dest,
      recipient: ctx.owner,
      tx: {
        to: ADDRESSES.universalRouter,
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
      to: ADDRESSES.nfpm,
      data: "0x",
      value: 0n,
      description: "NFPM.burn",
    },
  });

  return receipt("exit", position, ctx, actions, fee);
}

function receipt(
  action: ActionReceipt["action"],
  position: PositionSnapshot,
  ctx: PlanContext,
  actions: PlannedAction[],
  fee: TreasuryFee | null,
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
    to: recipients(fee, ctx.owner),
    actions,
    treasuryFee: fee,
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

