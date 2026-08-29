import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { ADDRESSES } from "../src/constants.js";
import { buildCard } from "../src/core/card.js";
import {
  confirmFromMint,
  feeTierLabel,
  holdEconomics,
  isFullRange,
  MAX_TICK,
  MIN_TICK,
  positionsApiPayload,
  serializeLiveView,
  serializeMintView,
  serializeProjectedRange,
} from "../src/core/view.js";
import type { ActionReceipt, PositionSnapshot } from "../src/types.js";

const owner = getAddress("0x1111111111111111111111111111111111111111");

function snap(over: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    ref: { protocol: "V3", chainId: 8453, tokenId: 77n },
    owner,
    token0: { address: ADDRESSES.weth, symbol: "WETH", decimals: 18 },
    token1: { address: ADDRESSES.usdc, symbol: "USDC", decimals: 6 },
    fee: 500,
    tickSpacing: 10,
    tickLower: -200,
    tickUpper: 200,
    tickCurrent: 0,
    sqrtPriceX96: 2n ** 96n,
    liquidity: 1_000n,
    tokensOwed0: 0n,
    tokensOwed1: 0n,
    uncollected0: 1_000_000_000_000_000n,
    uncollected1: 2_000_000n,
    amount0: 1_000_000_000_000_000_000n,
    amount1: 3_000_000_000n,
    inRange: true,
    percentThroughRange: 50,
    pool: getAddress("0x2222222222222222222222222222222222222222"),
    ...over,
  };
}

describe("JSON position views", () => {
  it("labels Uniswap fee tiers without copying brand copy", () => {
    expect(feeTierLabel(500)).toBe("0.05%");
    expect(feeTierLabel(3000)).toBe("0.30%");
    expect(feeTierLabel(100)).toBe("0.01%");
  });

  it("treats v2 and min/max ticks as full range (0→∞, no panic)", () => {
    expect(isFullRange("V2", -10, 10)).toBe(true);
    expect(isFullRange("V3", MIN_TICK, MAX_TICK)).toBe(true);
    expect(isFullRange("V3", -200, 200)).toBe(false);
  });

  it("vs HOLD is LP (principal + fees) minus the entry bag", () => {
    const econ = holdEconomics({ positionUsd: 90, feesUsd: 10, holdUsd: 100 });
    expect(econ.lpUsd).toBe(100);
    expect(econ.holdDeltaUsd).toBe(0);
    expect(econ.ilUsd).toBe(-10);
    expect(econ.feesVsIlUsd).toBe(0);
    const ahead = holdEconomics({ positionUsd: 95, feesUsd: 20, holdUsd: 100 });
    expect(ahead.holdDeltaUsd).toBe(15);
    expect(ahead.holdDeltaPct).toBeCloseTo(0.15);
    expect(ahead.feesVsIlUsd).toBe(15);
  });

  it("serializes a live card with in-range status and HOLD Δ", () => {
    const card = buildCard(
      snap(),
      { price0Usd: 2000, price1Usd: 1 },
      { hold0: 1_000_000_000_000_000_000n, hold1: 3_000_000_000n },
      1_700_000_000,
      1_700_000_000 + 86_400,
    );
    const view = serializeLiveView(card);
    expect(view.kind).toBe("live");
    expect(view.pair).toBe("WETH/USDC");
    expect(view.feeLabel).toBe("0.05%");
    expect(view.status).toBe("in-range");
    expect(view.closed).toBe(false);
    expect(view.fullRange).toBe(false);
    expect(view.tokenId).toBe("77");
    expect(view.lpUsd).toBeCloseTo((card.positionUsd ?? 0) + (card.feesUsd ?? 0));
    expect(view.holdDeltaUsd).toBeCloseTo((view.lpUsd ?? 0) - (view.holdUsd ?? 0));
    expect(JSON.stringify(view)).not.toMatch(/bigint/i);
  });

  it("marks zero-liquidity positions closed and OOR when price is outside", () => {
    const closed = serializeLiveView(
      buildCard(snap({ liquidity: 0n, amount0: 0n, amount1: 0n }), { price0Usd: 1, price1Usd: 1 }, { hold0: 0n, hold1: 0n }),
    );
    expect(closed.status).toBe("closed");
    expect(closed.closed).toBe(true);

    const oor = serializeLiveView(
      buildCard(snap({ tickCurrent: 400, inRange: false, percentThroughRange: 100 }), { price0Usd: 1, price1Usd: 1 }, { hold0: 0n, hold1: 0n }),
    );
    expect(oor.status).toBe("oor");
    expect(oor.inRange).toBe(false);
  });

  it("projects a mint range as Projected, not Live", () => {
    const view = serializeMintView({
      protocol: "V3",
      symbol0: "WETH",
      symbol1: "USDC",
      decimals0: 18,
      decimals1: 6,
      fee: 500,
      pool: ADDRESSES.nfpm,
      tickCurrent: 0,
      tickLower: -1000,
      tickUpper: 1000,
      sqrtPriceX96: 2n ** 96n,
      amount0: 10n ** 18n,
      amount1: 2_000_000n,
    });
    expect(view.kind).toBe("projected");
    expect(view.status).toBe("in-range");
    expect(view.pair).toBe("WETH/USDC");
  });

  it("projects a re-range onto new ticks", () => {
    const view = serializeProjectedRange(snap({ tickCurrent: 80 }), { tickLower: -120, tickUpper: 280 });
    expect(view.kind).toBe("projected");
    expect(view.tickLower).toBe(-120);
    expect(view.tickUpper).toBe(280);
    expect(view.tickCurrent).toBe(80);
  });

  it("builds a confirm card with pair, ticks, amounts, fees, gas, protocol", () => {
    const receipt: ActionReceipt = {
      action: "mint",
      dryRun: true,
      skipped: false,
      from: owner,
      to: [owner],
      actions: [],
      treasuryFee: null,
      txs: [],
    };
    const confirm = confirmFromMint(
      {
        protocol: "V3",
        symbol0: "WETH",
        symbol1: "USDC",
        decimals0: 18,
        decimals1: 6,
        fee: 500,
        pool: ADDRESSES.nfpm,
        tickCurrent: 10,
        tickLower: -50,
        tickUpper: 50,
        sqrtPriceX96: 2n ** 96n,
        amount0: 10n ** 18n,
        amount1: 1_000_000n,
      },
      receipt,
    );
    expect(confirm.action).toBe("mint");
    expect(confirm.pair).toBe("WETH/USDC");
    expect(confirm.protocol).toBe("V3");
    expect(confirm.feeLabel).toBe("0.05%");
    expect(confirm.tickLower).toBe(-50);
    expect(confirm.gasUsd).toBe(0.15);
    expect(confirm.dryRun).toBe(true);
  });

  it("shapes the positions API envelope", () => {
    expect(positionsApiPayload({}).count).toBe(0);
    const filled = positionsApiPayload({
      owner,
      positions: [{ tokenId: "1", pair: "WETH/USDC" }],
    });
    expect(filled.count).toBe(1);
    expect(filled.owner).toBe(owner);
  });
});
