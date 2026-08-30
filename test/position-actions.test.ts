import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { TickMath } from "@uniswap/v3-sdk";
import { addressesFor } from "../src/chains.js";
import { activeMarkets } from "../src/markets/catalog.js";
import { buildPositionActionPlan, buildRebalancePositionActionPlan, positionPoolIsConfigured } from "../src/portfolio/position-actions.js";
import { TREASURY } from "../src/constants.js";
import type { PositionSnapshot } from "../src/types.js";

const owner = getAddress("0x1111111111111111111111111111111111111111");

describe("self-custodial position actions", () => {
  it("builds one non-empty batch that compounds after the disclosed 2% fee", () => {
    const plan = buildPositionActionPlan(snapshot(), owner, "base", "compound", TREASURY);
    expect(plan.serviceFeeBps).toBe(200);
    expect(plan.serviceFee.map((fee) => fee.amount)).toEqual(["200", "400"]);
    expect(plan.transactions.some((tx) => tx.description.includes("collect"))).toBe(true);
    expect(plan.transactions.some((tx) => tx.description.includes("increaseLiquidity"))).toBe(true);
    expect(plan.transactions.every((tx) => tx.data !== "0x")).toBe(true);
  });

  it("withdraws and burns the NFT in one NFPM call before fee transfers", () => {
    const plan = buildPositionActionPlan(snapshot(), owner, "base", "withdraw", TREASURY);
    expect(plan.serviceFeeBps).toBe(15);
    expect(plan.transactions[0]?.to).toBe(addressesFor("base").nfpm);
    expect(plan.transactions[0]?.description).toContain("decreaseLiquidity 100%");
    expect(plan.transactions.slice(1).every((tx) => tx.description.startsWith("ERC20.transfer"))).toBe(true);
  });

  it("allows a curator-added market to be withdrawn after an onchain rebalance", () => {
    const position = snapshot();
    const market = activeMarkets("base").find((candidate) => candidate.protocol === "V3")!;
    const replacement = {
      ...market,
      id: "registry-replacement",
      pool: "0x2222222222222222222222222222222222222222" as const,
      status: "paused" as const,
    };
    expect(positionPoolIsConfigured({ ...position, pool: replacement.pool }, [replacement])).toBe(true);
  });

  it("recentres an out-of-range V3 position in one non-empty atomic batch", () => {
    const position = snapshot({ tickCurrent: 600, sqrtPriceX96: BigInt(TickMath.getSqrtRatioAtTick(600).toString()), amount0: 0n, inRange: false, percentThroughRange: 100 });
    const plan = buildRebalancePositionActionPlan(position, owner, "base", TREASURY, {
      tokenIn: position.token1.address,
      tokenOut: position.token0.address,
      amountIn: 900_000n,
      minimumAmountOut: 400_000n,
    });

    expect(plan.kind).toBe("rebalance");
    expect(plan.serviceFeeBps).toBe(15);
    expect(plan.range?.tickLower).toBeLessThanOrEqual(position.tickCurrent);
    expect(plan.range?.tickUpper).toBeGreaterThan(position.tickCurrent);
    expect(plan.transactions[0]?.description).toContain("decreaseLiquidity 100%");
    expect(plan.transactions.some((transaction) => transaction.to === addressesFor("base").swapRouter02)).toBe(true);
    expect(plan.transactions.at(-1)?.description).toBe("NFPM.mint");
    expect(plan.transactions.every((transaction) => transaction.data !== "0x")).toBe(true);
  });

  it("does not rebalance a position that is already earning", () => {
    expect(() => buildRebalancePositionActionPlan(snapshot(), owner, "base", TREASURY)).toThrow("already in range");
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
