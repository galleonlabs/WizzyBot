import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { ADDRESSES } from "../src/constants.js";
import { planCompound, planRerange, type PlanContext } from "../src/core/actions.js";
import { resolveActionFee } from "../src/core/fees.js";
import { availableAfterUnwind, hydrateCalldata } from "../src/core/hydrate.js";
import type { PositionSnapshot } from "../src/types.js";

const owner = getAddress("0x1111111111111111111111111111111111111111");

function snap(over: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    ref: { protocol: "V3", chainId: 8453, tokenId: 7n },
    owner,
    token0: { address: ADDRESSES.weth, symbol: "WETH", decimals: 18 },
    token1: { address: ADDRESSES.usdc, symbol: "USDC", decimals: 6 },
    fee: 500,
    tickSpacing: 10,
    tickLower: 100,
    tickUpper: 200,
    tickCurrent: 0,
    sqrtPriceX96: 2n ** 96n,
    liquidity: 1_000_000n,
    tokensOwed0: 0n,
    tokensOwed1: 0n,
    uncollected0: 1_000n,
    uncollected1: 2_000n,
    amount0: 1_000_000n,
    amount1: 2_000_000n,
    inRange: false,
    percentThroughRange: 0,
    pool: getAddress("0x2222222222222222222222222222222222222222"),
    ...over,
  };
}

const ctx: PlanContext = {
  owner,
  dryRun: true,
  noFee: true,
  feeSource: "notional",
  minFeeUsd: 1,
  minPositionUsd: 50,
  feesUsd: 25,
  notionalUsd: 4000,
  gasUsd: 0.2,
  takeBps: 0,
  takeBaseUsd: 4000,
};

describe("hydrate no-fee actions", () => {
  it("unwinds principal and fees for rerange without a treasury take", () => {
    const position = snap();
    const available = availableAfterUnwind(position, true);
    expect(available.amount0).toBe(1_001_000n);
    expect(available.amount1).toBe(2_002_000n);

    const receipt = planRerange(position, ctx, { oorPercent: 0 });
    expect(receipt.treasuryFee).toBeNull();

    const filled = hydrateCalldata(receipt, position, owner);
    const mint = filled.actions.find((a) => a.kind === "mint");
    expect(mint?.tx?.data && mint.tx.data !== "0x").toBe(true);
    expect(filled.actions.some((a) => a.kind === "transfer" && a.recipient !== owner)).toBe(false);
  });

  it("reinvests all uncollected fees", () => {
    const position = snap({ tickCurrent: 0, inRange: true, uncollected0: 10_000n, uncollected1: 10_000n });
    const receipt = planCompound(position, { ...ctx, feeSource: "fees", takeBps: 200, takeBaseUsd: 25 });
    expect(receipt.skipped).toBe(false);
    const filled = hydrateCalldata(receipt, position, owner);
    const increase = filled.actions.find((a) => a.kind === "increase");
    expect(increase?.tx?.description).toMatch(/increaseLiquidity/);
    expect(increase?.amountIn).toBe(10_000n);
  });

  it("does not attach a 0-min-out swap", () => {
    const position = snap();
    const receipt = planRerange(position, ctx, { oorPercent: 0 });
    const fee = resolveActionFee({
      action: "rerange",
      feeSource: "notional",
      noFee: false,
      uncollected0: position.uncollected0,
      uncollected1: position.uncollected1,
      notional0: position.amount0,
      notional1: position.amount1,
      token0: position.token0.address,
      token1: position.token1.address,
    });
    expect(fee.amount0).toBe(0n);
    const filled = hydrateCalldata(receipt, position, owner);
    const swap = filled.actions.find((a) => a.kind === "swap");
    if (swap?.tx) {
      expect(swap.tx.data === "0x" || swap.tx.data === "0x0").toBe(true);
    }
  });
});
