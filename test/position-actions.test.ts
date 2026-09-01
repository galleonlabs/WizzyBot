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
  it("collects V3 fees directly to the owner without a Wizzy fee", () => {
    const plan = buildPositionActionPlan(snapshot(), owner, "base", "collect", TREASURY);
    expect(plan.kind).toBe("collect");
    expect(plan.serviceFeeBps).toBe(0);
    expect(plan.serviceFee).toEqual([]);
    expect(plan.transactions).toHaveLength(1);
    expect(plan.transactions[0]?.description).toBe("NFPM.collect");
    expect(plan.allowedTargets).not.toContain(TREASURY);
    expect(plan.notices[0]).toContain("does not charge");
  });

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

  it("recentres an out-of-range V3 position through a non-empty wallet plan", () => {
    const position = snapshot({ tickCurrent: 600, sqrtPriceX96: BigInt(TickMath.getSqrtRatioAtTick(600).toString()), amount0: 0n, inRange: false, percentThroughRange: 100 });
    const plan = buildRebalancePositionActionPlan(position, owner, "base", TREASURY, {
      venue: "uniswap-v3",
      router: addressesFor("base").swapRouter02,
      tokenIn: position.token1.address,
      tokenOut: position.token0.address,
      amountIn: 900_000n,
      minimumAmountOut: 400_000n,
      fee: position.fee,
    });

    expect(plan.kind).toBe("rebalance");
    expect(plan.serviceFeeBps).toBe(15);
    expect(plan.range?.tickLower).toBeLessThanOrEqual(position.tickCurrent);
    expect(plan.range?.tickUpper).toBeGreaterThan(position.tickCurrent);
    expect(plan.transactions[0]?.description).toContain("decreaseLiquidity 100%");
    expect(plan.transactions.some((transaction) => transaction.to === addressesFor("base").swapRouter02)).toBe(true);
    expect(plan.transactions.at(-1)?.description).toBe("NFPM.mint");
    expect(plan.transactions.every((transaction) => transaction.data !== "0x")).toBe(true);
    expect(plan.atomic).toBe(false);
  });

  it("does not rebalance a position that is already earning", () => {
    expect(() => buildRebalancePositionActionPlan(snapshot(), owner, "base", TREASURY)).toThrow("already in range");
  });

  it("withdraws a Robinhood V2 LP through the Robinhood router", () => {
    const addresses = addressesFor("robinhood");
    const market = activeMarkets("robinhood")[0]!;
    const pair = "0x0579fA41416101b66e202F66bF3B0de5101F5b9F" as const;
    const position = snapshot({
      ref: { protocol: "V2", chainId: 4663, tokenId: BigInt(pair) },
      token0: { address: market.token, symbol: market.symbol, decimals: market.tokenDecimals },
      token1: { address: addresses.weth, symbol: "WETH", decimals: 18 },
      pool: pair,
      liquidity: 500_000n,
      uncollected0: 0n,
      uncollected1: 0n,
    });
    const plan = buildPositionActionPlan(position, owner, "robinhood", "withdraw", TREASURY);
    expect(plan.transactions[0]?.to).toBe(pair);
    expect(plan.transactions[1]?.to).toBe(addresses.v2Router);
    expect(plan.transactions.slice(2).every((tx) => tx.description.startsWith("ERC20.transfer"))).toBe(true);
    expect(plan.allowedTargets).toContain(addresses.v2Router);
    expect(() => buildPositionActionPlan(position, owner, "robinhood", "compound", TREASURY)).toThrow("already reinvested");
    expect(() => buildPositionActionPlan(position, owner, "robinhood", "collect", TREASURY)).toThrow("already reinvested");
  });

  it("claims and compounds a Base V4 position through Permit2", () => {
    const addresses = addressesFor("base");
    const position = snapshot({ ref: { protocol: "V4", chainId: 8453, tokenId: 88n } });
    const plan = buildPositionActionPlan(position, owner, "base", "compound", TREASURY);
    expect(plan.transactions[0]?.description).toContain("claim");
    expect(plan.transactions.some((tx) => tx.to === addresses.permit2)).toBe(true);
    expect(plan.transactions.at(-1)?.to).toBe(addresses.v4PositionManager);
    expect(plan.transactions.at(-1)?.description).toContain("increase");
    expect(plan.transactions.every((tx) => tx.data !== "0x")).toBe(true);
  });

  it("burns, swaps, unwraps, and recentres an out-of-range Base V4 position", () => {
    const addresses = addressesFor("base");
    const position = snapshot({
      ref: { protocol: "V4", chainId: 8453, tokenId: 93n },
      token0: { address: addresses.weth, symbol: "ETH", decimals: 18 },
      tickCurrent: 600,
      sqrtPriceX96: BigInt(TickMath.getSqrtRatioAtTick(600).toString()),
      amount0: 0n,
      amount1: 2_000_000n,
      inRange: false,
      percentThroughRange: 100,
    });
    const plan = buildRebalancePositionActionPlan(position, owner, "base", TREASURY, {
      venue: "aerodrome-slipstream",
      router: "0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F",
      tokenIn: position.token1.address,
      tokenOut: position.token0.address,
      amountIn: 900_000n,
      minimumAmountOut: 400_000n,
      tickSpacing: 200,
    });

    expect(plan.kind).toBe("rebalance");
    expect(plan.atomic).toBe(false);
    expect(plan.range).toEqual({ tickLower: 400, tickUpper: 800 });
    expect(plan.transactions[0]?.to).toBe(addresses.v4PositionManager);
    expect(plan.transactions[0]?.description).toContain("burn");
    expect(plan.transactions.some((transaction) => transaction.description.includes("exact-in"))).toBe(true);
    expect(plan.transactions.some((transaction) => transaction.description.includes("Aerodrome"))).toBe(true);
    expect(plan.transactions.some((transaction) => transaction.description.startsWith("WETH.withdraw"))).toBe(true);
    expect(plan.transactions.filter((transaction) => transaction.to === addresses.permit2)).toHaveLength(1);
    expect(plan.transactions.at(-1)?.description).toContain("mint");
    expect(BigInt(plan.transactions.at(-1)?.value ?? "0")).toBeGreaterThan(0n);
    expect(plan.transactions.every((transaction) => transaction.data !== "0x")).toBe(true);
  });

  it("wraps native ETH before recentring a Robinhood V4 position", () => {
    const addresses = addressesFor("robinhood");
    const market = activeMarkets("robinhood").find((candidate) => candidate.protocol === "V3")!;
    const position = snapshot({
      ref: { protocol: "V4", chainId: 4663, tokenId: 94n },
      token0: { address: addresses.weth, symbol: "ETH", decimals: 18 },
      token1: { address: market.token, symbol: market.symbol, decimals: market.tokenDecimals },
      tickCurrent: -600,
      sqrtPriceX96: BigInt(TickMath.getSqrtRatioAtTick(-600).toString()),
      amount0: 2_000_000n,
      amount1: 0n,
      inRange: false,
      percentThroughRange: 0,
      pool: addresses.v4PoolManager,
    });
    const plan = buildRebalancePositionActionPlan(position, owner, "robinhood", TREASURY, {
      venue: "uniswap-v3",
      router: addresses.swapRouter02,
      tokenIn: position.token0.address,
      tokenOut: position.token1.address,
      amountIn: 900_000n,
      minimumAmountOut: 400_000n,
      fee: market.fee,
    });

    expect(plan.transactions.some((transaction) => transaction.description.startsWith("WETH.deposit"))).toBe(true);
    expect(plan.transactions.at(-1)?.to).toBe(addresses.v4PositionManager);
    expect(plan.allowedTargets).toContain(addresses.permit2);
    expect(plan.transactions.every((transaction) => plan.allowedTargets.includes(transaction.to))).toBe(true);
  });

  it("collects V4 fees without increasing or charging the position", () => {
    const addresses = addressesFor("base");
    const position = snapshot({ ref: { protocol: "V4", chainId: 8453, tokenId: 92n } });
    const plan = buildPositionActionPlan(position, owner, "base", "collect", TREASURY);
    expect(plan.serviceFeeBps).toBe(0);
    expect(plan.transactions).toHaveLength(1);
    expect(plan.transactions[0]?.to).toBe(addresses.v4PositionManager);
    expect(plan.transactions[0]?.description).toContain("claim");
    expect(plan.transactions.some((transaction) => transaction.description.includes("increase"))).toBe(false);
  });

  it("refuses an empty fee collection", () => {
    expect(() => buildPositionActionPlan(snapshot({ uncollected0: 0n, uncollected1: 0n }), owner, "base", "collect", TREASURY)).toThrow("No fees are ready");
  });

  it("burns a Base V4 position before transferring the disclosed fee", () => {
    const addresses = addressesFor("base");
    const position = snapshot({ ref: { protocol: "V4", chainId: 8453, tokenId: 89n } });
    const plan = buildPositionActionPlan(position, owner, "base", "withdraw", TREASURY);
    expect(plan.transactions[0]?.to).toBe(addresses.v4PositionManager);
    expect(plan.transactions[0]?.description).toContain("burn");
    expect(plan.transactions.slice(1).every((tx) => tx.description.startsWith("ERC20.transfer"))).toBe(true);
  });

  it("pays V4 native ETH fees as value instead of pretending ETH is WETH", () => {
    const addresses = addressesFor("base");
    const position = snapshot({
      ref: { protocol: "V4", chainId: 8453, tokenId: 91n },
      token0: { address: addresses.weth, symbol: "ETH", decimals: 18 },
    });
    const plan = buildPositionActionPlan(position, owner, "base", "withdraw", TREASURY);
    const feeTransfer = plan.transactions.find((tx) => tx.to === TREASURY);
    expect(feeTransfer?.data).toBe("0x");
    expect(BigInt(feeTransfer?.value ?? "0")).toBeGreaterThan(0n);
  });

  it("accepts curated meme pairs across Uniswap protocol versions", () => {
    const market = activeMarkets("base").find((candidate) => candidate.protocol === "V3")!;
    const position = snapshot({
      ref: { protocol: "V4", chainId: 8453, tokenId: 90n },
      pool: addressesFor("base").v4PoolManager,
    });
    expect(positionPoolIsConfigured(position, [market])).toBe(true);
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
