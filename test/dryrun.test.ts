import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { ADDRESSES, TREASURY } from "../src/constants.js";
import { planCompound, planExit, planRerange, type PlanContext } from "../src/core/actions.js";
import type { PositionSnapshot } from "../src/types.js";

const owner = getAddress("0x1111111111111111111111111111111111111111");

function snap(over: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    ref: { protocol: "V3", chainId: 8453, tokenId: 4242n },
    owner,
    token0: { address: ADDRESSES.weth, symbol: "WETH", decimals: 18 },
    token1: { address: ADDRESSES.usdc, symbol: "USDC", decimals: 6 },
    fee: 500,
    tickSpacing: 10,
    tickLower: -200,
    tickUpper: 200,
    tickCurrent: 250,
    sqrtPriceX96: 2n ** 96n,
    liquidity: 1_000_000n,
    tokensOwed0: 0n,
    tokensOwed1: 0n,
    uncollected0: 1_000_000_000_000_000n,
    uncollected1: 5_000_000n,
    amount0: 1_000_000_000_000_000_000n,
    amount1: 3_000_000_000n,
    inRange: false,
    percentThroughRange: 100,
    pool: getAddress("0x2222222222222222222222222222222222222222"),
    ...over,
  };
}

const ctx: PlanContext = {
  owner,
  dryRun: true,
  noFee: false,
  feeSource: "fees",
  minFeeUsd: 1,
  minPositionUsd: 50,
  feesUsd: 25,
  notionalUsd: 4000,
  gasUsd: 0.2,
  takeBps: 200,
};

describe("mocked dry-run receipts", () => {
  it("compound: collect → treasury take → increase, no broadcast", () => {
    const receipt = planCompound(snap({ tickCurrent: 0, inRange: true }), ctx);
    expect(receipt.dryRun).toBe(true);
    expect(receipt.skipped).toBe(false);
    expect(receipt.from).toBe(owner);
    expect(receipt.to).toContain(TREASURY);
    expect(receipt.to).toContain(ADDRESSES.nfpm);
    expect(receipt.actions.map((a) => a.kind)).toEqual(
      expect.arrayContaining(["collect", "transfer", "increase"]),
    );
    expect(receipt.treasuryFee?.recipient).toBe(TREASURY);
    expect(receipt.treasuryFee?.amount0).toBe(20_000_000_000_000n);
    expect(receipt.treasuryFee?.amount1).toBe(100_000n);
    expect(receipt.treasuryFee?.bps).toBe(200);
    expect(receipt.hash).toBeUndefined();
  });

  it("re-range: decrease, collect, treasury, mint, leftovers to owner", () => {
    const receipt = planRerange(snap(), ctx, { oorPercent: 0 });
    expect(receipt.dryRun).toBe(true);
    expect(receipt.skipped).toBe(false);
    expect(receipt.actions.map((a) => a.kind)).toEqual(
      expect.arrayContaining(["decrease", "collect", "transfer", "mint"]),
    );
    expect(receipt.actions.some((a) => a.description.includes("leftover"))).toBe(true);
    expect(receipt.treasuryFee?.recipient).toBe(TREASURY);
    expect(receipt.from).toBe(owner);
    expect(receipt.to).toEqual(expect.arrayContaining([owner, TREASURY, ADDRESSES.nfpm]));
  });

  it("exit: decrease, collect, treasury, optional swap, burn", () => {
    const receipt = planExit(snap(), ctx, { swapTo: ADDRESSES.usdc });
    expect(receipt.dryRun).toBe(true);
    expect(receipt.skipped).toBe(false);
    expect(receipt.actions.map((a) => a.kind)).toEqual(
      expect.arrayContaining(["decrease", "collect", "transfer", "swap", "burn"]),
    );
    expect(receipt.actions.find((a) => a.kind === "swap")?.tx?.to).toBe(ADDRESSES.universalRouter);
    expect(receipt.treasuryFee?.recipient).toBe(TREASURY);
    expect(receipt.hash).toBeUndefined();
  });

  it("does not emit a treasury take when --no-fee", () => {
    const receipt = planCompound(snap({ tickCurrent: 0 }), { ...ctx, noFee: true });
    expect(receipt.treasuryFee?.skipped).toBe(true);
    expect(receipt.actions.filter((a) => a.kind === "transfer")).toHaveLength(0);
  });
});
