import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { addressesFor } from "../src/chains.js";
import { activeMarkets } from "../src/markets/catalog.js";
import { atomicActionsFor, buildDecreasePositionActionPlan, buildPositionActionPlan, positionPoolIsConfigured } from "../src/portfolio/position-actions.js";
import { TREASURY } from "../src/constants.js";
import type { PositionSnapshot } from "../src/types.js";

const owner = getAddress("0x1111111111111111111111111111111111111111");
const AERODROME_MANAGER = "0x827922686190790b37229fd06084350E74485b72" as const;

describe("single-transaction position actions", () => {
  it("collects V3 fees to the owner in one transaction with no Wizzy fee", () => {
    const plan = buildPositionActionPlan(snapshot(), owner, "base", "collect");
    expect(plan.kind).toBe("collect");
    expect(plan.atomic).toBe(true);
    expect(plan.serviceFeeBps).toBe(0);
    expect(plan.transactions).toHaveLength(1);
    expect(plan.transactions[0]?.description).toBe("NFPM.collect");
    expect(plan.allowedTargets).toEqual([addressesFor("base").nfpm]);
    expect(plan.allowedTargets).not.toContain(TREASURY);
    expect(plan.tokens).toMatchObject({ symbol0: "WETH", decimals0: 18, symbol1: activeMarkets("base").find((market) => market.protocol === "V3")!.symbol });
  });

  it("closes a V3 position and burns the NFT in one multicall", () => {
    const plan = buildPositionActionPlan(snapshot(), owner, "base", "withdraw");
    expect(plan.transactions).toHaveLength(1);
    expect(plan.transactions[0]?.description).toContain("decreaseLiquidity 100%");
    expect(plan.removal).toEqual({ percent: 100, amount0: "1000000", amount1: "2000000", burn: true });
    expect(plan.notices[1]).toContain("Relay step");
  });

  it("removes a chosen share of a V3 position and keeps the NFT", () => {
    const plan = buildDecreasePositionActionPlan(snapshot(), owner, "base", 40);
    expect(plan.kind).toBe("decrease");
    expect(plan.removal).toEqual({ percent: 40, amount0: "400000", amount1: "800000", burn: false });
    expect(plan.transactions).toHaveLength(1);
    expect(plan.transactions[0]?.description).toBe("NFPM.decreaseLiquidity 40%");
    expect(() => buildDecreasePositionActionPlan(snapshot(), owner, "base", 100)).toThrow("between 1% and 99%");
  });

  it("handles V4 claims, partial removals, and burns through the position manager", () => {
    const addresses = addressesFor("base");
    const position = snapshot({ ref: { protocol: "V4", chainId: 8453, tokenId: 88n } });
    expect(buildPositionActionPlan(position, owner, "base", "collect").transactions[0]?.description).toContain("claim");
    const decrease = buildDecreasePositionActionPlan(position, owner, "base", 50);
    expect(decrease.transactions).toHaveLength(1);
    expect(decrease.transactions[0]?.to).toBe(addresses.v4PositionManager);
    expect(buildPositionActionPlan(position, owner, "base", "withdraw").transactions[0]?.description).toContain("burn");
  });

  it("collects Aerodrome fees but sends multi-step removals to aerodrome.finance", () => {
    const position = snapshot({ venue: "aerodrome-slipstream", positionManager: AERODROME_MANAGER, ref: { protocol: "V3", chainId: 8453, tokenId: 12n, venue: "aerodrome-slipstream", positionManager: AERODROME_MANAGER } });
    const collect = buildPositionActionPlan(position, owner, "base", "collect");
    expect(collect.transactions[0]?.description).toBe("Aerodrome collect");
    expect(collect.allowedTargets).toEqual([AERODROME_MANAGER]);
    expect(() => buildPositionActionPlan(position, owner, "base", "withdraw")).toThrow("aerodrome.finance");
    expect(() => buildDecreasePositionActionPlan(position, owner, "base", 25)).toThrow("aerodrome.finance");
    expect(atomicActionsFor(position)).toEqual(["collect"]);
  });

  it("never prepares V2 actions and refuses empty collections", () => {
    const v2 = snapshot({ ref: { protocol: "V2", chainId: 8453, tokenId: 1n } });
    expect(() => buildPositionActionPlan(v2, owner, "base", "withdraw")).toThrow("managed on Uniswap");
    expect(atomicActionsFor(v2)).toEqual([]);
    expect(() => buildPositionActionPlan(snapshot({ uncollected0: 0n, uncollected1: 0n }), owner, "base", "collect")).toThrow("No fees are ready");
    expect(atomicActionsFor(snapshot({ uncollected0: 0n, uncollected1: 0n }))).toEqual(["decrease", "withdraw"]);
    expect(atomicActionsFor(snapshot())).toEqual(["collect", "decrease", "withdraw"]);
  });

  it("does not require the catalog to manage a position", () => {
    const stranger = snapshot({ token1: { address: "0x3333333333333333333333333333333333333333", symbol: "STRANGER", decimals: 18 }, pool: "0x4444444444444444444444444444444444444444" });
    expect(positionPoolIsConfigured(stranger, activeMarkets("base"))).toBe(false);
    expect(buildPositionActionPlan(stranger, owner, "base", "collect").transactions).toHaveLength(1);
    expect(buildDecreasePositionActionPlan(stranger, owner, "base", 10).kind).toBe("decrease");
  });

  it("refuses positions owned by someone else or on another chain", () => {
    expect(() => buildPositionActionPlan(snapshot({ owner: getAddress("0x2222222222222222222222222222222222222222") }), owner, "base", "collect")).toThrow("does not own");
    expect(() => buildPositionActionPlan(snapshot(), owner, "robinhood", "collect")).toThrow("chain mismatch");
  });
});

function snapshot(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  const market = activeMarkets("base").find((candidate) => candidate.protocol === "V3")!;
  const weth = addressesFor("base").weth;
  return {
    ref: { protocol: "V3", chainId: 8453, tokenId: 77n },
    owner,
    token0: { address: weth, symbol: "WETH", decimals: 18 },
    token1: { address: market.token, symbol: market.symbol, decimals: market.tokenDecimals },
    fee: market.fee,
    tickSpacing: market.tickSpacing,
    tickLower: -200,
    tickUpper: 200,
    tickCurrent: 0,
    sqrtPriceX96: 2n ** 96n,
    liquidity: 1_000_000n,
    tokensOwed0: 0n,
    tokensOwed1: 0n,
    uncollected0: 10_000n,
    uncollected1: 20_000n,
    amount0: 1_000_000n,
    amount1: 2_000_000n,
    inRange: true,
    percentThroughRange: 50,
    pool: market.pool,
    ...overrides,
  };
}
