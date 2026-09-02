import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { TickMath } from "@uniswap/v3-sdk";
import { addressesFor } from "../src/chains.js";
import { activeMarkets } from "../src/markets/catalog.js";
import {
  buildDecreasePositionActionPlan,
  buildEthSettlement,
  buildIncreaseFromEthPlan,
  buildIncreasePositionActionPlan,
  buildPositionActionPlan,
  buildRebalancePositionActionPlan,
  planRangeSwap,
  poolContext,
  positionPoolIsConfigured,
  supportsEthSettlement,
  targetRangeFromTicks,
} from "../src/portfolio/position-actions.js";
import { TREASURY } from "../src/constants.js";
import type { PositionSnapshot } from "../src/types.js";
import type { AllocationPlan } from "../src/portfolio/allocation.js";

const owner = getAddress("0x1111111111111111111111111111111111111111");

describe("self-custodial position actions", () => {
  it("collects V3 fees directly to the owner without a Wizzy fee", () => {
    const plan = buildPositionActionPlan(snapshot(), owner, "base", "collect");
    expect(plan.kind).toBe("collect");
    expect(plan.serviceFeeBps).toBe(0);
    expect(plan.serviceFee).toEqual([]);
    expect(plan.transactions).toHaveLength(1);
    expect(plan.transactions[0]?.description).toBe("NFPM.collect");
    expect(plan.allowedTargets).not.toContain(TREASURY);
    expect(plan.notices[0]).toContain("does not charge");
  });

  it("reinvests all claimable fees without a separable Wizzy fee transfer", () => {
    const plan = buildPositionActionPlan(snapshot(), owner, "base", "compound");
    expect(plan.serviceFeeBps).toBe(0);
    expect(plan.serviceFee).toEqual([]);
    expect(plan.allowedTargets).not.toContain(TREASURY);
    expect(plan.transactions.some((tx) => tx.description.startsWith("ERC20.transfer"))).toBe(false);
    expect(plan.transactions.some((tx) => tx.description.includes("collect"))).toBe(true);
    expect(plan.transactions.some((tx) => tx.description.includes("increaseLiquidity"))).toBe(true);
    expect(plan.transactions.every((tx) => tx.data !== "0x")).toBe(true);
  });

  it("replaces a fresh-allocation mint with an increase on the exact V3 NFT", () => {
    const position = snapshot();
    const addresses = addressesFor("base");
    const allocation = allocationPlan(position, "V3", "uniswap-v3", addresses.nfpm, "NFPM.mint");
    const plan = buildIncreasePositionActionPlan(position, allocation);

    expect(plan.kind).toBe("increase");
    expect(plan.tokenId).toBe(position.ref.tokenId.toString());
    expect(plan.funding).toMatchObject({ amountWei: allocation.amountWei, serviceFeeWei: allocation.serviceFeeWei });
    expect(plan.transactions.some((transaction) => transaction.description === "NFPM.mint")).toBe(false);
    expect(plan.transactions.some((transaction) => transaction.description === "NFPM.increaseLiquidity")).toBe(true);
    expect(plan.transactions.every((transaction) => transaction.data !== "0x" || BigInt(transaction.value) > 0n)).toBe(true);
  });

  it("funds a V3 increase with native ETH instead of requiring WETH approval", () => {
    const position = snapshot();
    const addresses = addressesFor("base");
    const allocation = allocationPlan(position, "V3", "uniswap-v3", addresses.nfpm, "NFPM.mint");
    allocation.markets[0]!.quoteSymbol = "ETH";
    allocation.transactions = allocation.transactions.filter((transaction) => transaction.to !== addresses.weth);
    const plan = buildIncreasePositionActionPlan(position, allocation);
    const increase = plan.transactions.find((transaction) => transaction.description === "NFPM.increaseLiquidity");

    expect(increase).toBeDefined();
    expect(BigInt(increase!.value)).toBeGreaterThan(0n);
    expect(plan.transactions.some((transaction) => transaction.to === addresses.weth)).toBe(false);
  });

  it("adds to an existing V2 pool balance instead of creating a separate market", () => {
    const addresses = addressesFor("base");
    const pair = "0x2222222222222222222222222222222222222222" as const;
    const position = snapshot({ ref: { protocol: "V2", chainId: 8453, tokenId: BigInt(pair) }, pool: pair });
    const plan = buildIncreasePositionActionPlan(position, allocationPlan(position, "V2", "uniswap-v2", addresses.v2Router, "Router02.addLiquidity"));

    expect(plan.transactions.filter((transaction) => transaction.description === "Router02.addLiquidity")).toHaveLength(1);
    expect(plan.transactions.some((transaction) => transaction.to === addresses.v2Router)).toBe(true);
  });

  it("increases the exact V4 NFT and rejects a quote for another pool", () => {
    const addresses = addressesFor("base");
    const poolId = `0x${"11".repeat(32)}` as const;
    const position = snapshot({
      ref: { protocol: "V4", chainId: 8453, tokenId: 88n },
      token0: { address: addresses.weth, symbol: "ETH", decimals: 18 },
      pool: addresses.v4PoolManager,
      poolId,
    });
    const allocation = allocationPlan(position, "V4", "uniswap-v4", addresses.v4PositionManager, "PositionManager.modifyLiquidities mint");
    const plan = buildIncreasePositionActionPlan(position, allocation);

    expect(plan.transactions.some((transaction) => transaction.description === "PositionManager.modifyLiquidities mint")).toBe(false);
    expect(plan.transactions.some((transaction) => transaction.description.includes("increase"))).toBe(true);
    expect(() => buildIncreasePositionActionPlan(position, {
      ...allocation,
      markets: [{ ...allocation.markets[0]!, pool: `0x${"22".repeat(32)}` }],
    })).toThrow("does not target this position's pool");
  });

  it("withdraws and burns the NFT without a separable Wizzy fee transfer", () => {
    const plan = buildPositionActionPlan(snapshot(), owner, "base", "withdraw");
    expect(plan.serviceFeeBps).toBe(0);
    expect(plan.transactions[0]?.to).toBe(addressesFor("base").nfpm);
    expect(plan.transactions[0]?.description).toContain("decreaseLiquidity 100%");
    expect(plan.transactions.some((tx) => tx.description.startsWith("ERC20.transfer"))).toBe(false);
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
    const plan = buildRebalancePositionActionPlan(position, owner, "base", {
      venue: "uniswap-v3",
      router: addressesFor("base").swapRouter02,
      tokenIn: position.token1.address,
      tokenOut: position.token0.address,
      amountIn: 900_000n,
      minimumAmountOut: 400_000n,
      fee: position.fee,
    });

    expect(plan.kind).toBe("rebalance");
    expect(plan.serviceFeeBps).toBe(0);
    expect(plan.serviceFee).toEqual([]);
    expect(plan.allowedTargets).not.toContain(TREASURY);
    expect(plan.range?.tickLower).toBeLessThanOrEqual(position.tickCurrent);
    expect(plan.range?.tickUpper).toBeGreaterThan(position.tickCurrent);
    expect(plan.transactions[0]?.description).toContain("decreaseLiquidity 100%");
    expect(plan.transactions.some((transaction) => transaction.to === addressesFor("base").swapRouter02)).toBe(true);
    expect(plan.transactions.at(-1)?.description).toBe("NFPM.mint");
    expect(plan.transactions.every((transaction) => transaction.data !== "0x")).toBe(true);
    expect(plan.atomic).toBe(false);
  });

  it("lets an earning position deliberately narrow or widen its range", () => {
    const focused = buildRebalancePositionActionPlan(snapshot(), owner, "base", undefined, "focused");
    const wide = buildRebalancePositionActionPlan(snapshot(), owner, "base", undefined, "wide");
    expect(focused.range).toMatchObject({ preset: "focused", previousTickLower: -200, previousTickUpper: 200, currentTick: 0 });
    expect(wide.range).toMatchObject({ preset: "wide", previousTickLower: -200, previousTickUpper: 200, currentTick: 0 });
    expect(focused.range!.tickUpper - focused.range!.tickLower).toBeLessThan(400);
    expect(wide.range!.tickUpper - wide.range!.tickLower).toBeGreaterThan(400);
    expect(focused.notices[0]).toContain("focused range");
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
    const plan = buildPositionActionPlan(position, owner, "robinhood", "withdraw");
    expect(plan.transactions[0]?.to).toBe(pair);
    expect(plan.transactions[1]?.to).toBe(addresses.v2Router);
    expect(plan.transactions.slice(2).every((tx) => tx.description.startsWith("ERC20.transfer"))).toBe(true);
    expect(plan.allowedTargets).toContain(addresses.v2Router);
    expect(() => buildPositionActionPlan(position, owner, "robinhood", "compound")).toThrow("already reinvested");
    expect(() => buildPositionActionPlan(position, owner, "robinhood", "collect")).toThrow("already reinvested");
  });

  it("claims and compounds a Base V4 position through Permit2", () => {
    const addresses = addressesFor("base");
    const position = snapshot({ ref: { protocol: "V4", chainId: 8453, tokenId: 88n } });
    const plan = buildPositionActionPlan(position, owner, "base", "compound");
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
    const plan = buildRebalancePositionActionPlan(position, owner, "base", {
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
    expect(plan.range).toMatchObject({
      tickLower: 400,
      tickUpper: 800,
      currentTick: 600,
      previousTickLower: -200,
      previousTickUpper: 200,
      preset: "balanced",
    });
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
    const plan = buildRebalancePositionActionPlan(position, owner, "robinhood", {
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
    const plan = buildPositionActionPlan(position, owner, "base", "collect");
    expect(plan.serviceFeeBps).toBe(0);
    expect(plan.transactions).toHaveLength(1);
    expect(plan.transactions[0]?.to).toBe(addresses.v4PositionManager);
    expect(plan.transactions[0]?.description).toContain("claim");
    expect(plan.transactions.some((transaction) => transaction.description.includes("increase"))).toBe(false);
  });

  it("refuses an empty fee collection", () => {
    expect(() => buildPositionActionPlan(snapshot({ uncollected0: 0n, uncollected1: 0n }), owner, "base", "collect")).toThrow("No fees are ready");
  });

  it("burns a Base V4 position without adding a fee transfer", () => {
    const addresses = addressesFor("base");
    const position = snapshot({ ref: { protocol: "V4", chainId: 8453, tokenId: 89n } });
    const plan = buildPositionActionPlan(position, owner, "base", "withdraw");
    expect(plan.transactions[0]?.to).toBe(addresses.v4PositionManager);
    expect(plan.transactions[0]?.description).toContain("burn");
    expect(plan.transactions).toHaveLength(1);
  });

  it("does not add a native ETH fee transfer to V4 withdrawals", () => {
    const addresses = addressesFor("base");
    const position = snapshot({
      ref: { protocol: "V4", chainId: 8453, tokenId: 91n },
      token0: { address: addresses.weth, symbol: "ETH", decimals: 18 },
    });
    const plan = buildPositionActionPlan(position, owner, "base", "withdraw");
    expect(plan.transactions.some((tx) => tx.to === TREASURY)).toBe(false);
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

describe("position management 2.0", () => {
  it("removes a chosen share of a V3 position and keeps the NFT", () => {
    const plan = buildDecreasePositionActionPlan(snapshot(), owner, "base", 40);
    expect(plan.kind).toBe("decrease");
    expect(plan.removal).toEqual({ percent: 40, amount0: "400000", amount1: "800000", burn: false });
    expect(plan.transactions).toHaveLength(1);
    expect(plan.transactions[0]?.description).toBe("NFPM.decreaseLiquidity 40%");
    expect(plan.transactions[0]?.to).toBe(addressesFor("base").nfpm);
    expect(plan.serviceFeeBps).toBe(0);
    expect(() => buildDecreasePositionActionPlan(snapshot(), owner, "base", 100)).toThrow("between 1% and 99%");
    expect(() => buildDecreasePositionActionPlan(snapshot(), owner, "base", 0)).toThrow("between 1% and 99%");
  });

  it("scales Aerodrome and V4 partial removals by liquidity share", () => {
    const manager = "0x827922686190790b37229fd06084350E74485b72" as const;
    const aerodrome = snapshot({ venue: "aerodrome-slipstream", positionManager: manager, ref: { protocol: "V3", chainId: 8453, tokenId: 12n, venue: "aerodrome-slipstream", positionManager: manager } });
    const aeroPlan = buildDecreasePositionActionPlan(aerodrome, owner, "base", 25);
    expect(aeroPlan.transactions.map((tx) => tx.description)).toEqual(["Aerodrome decreaseLiquidity 25%", "Aerodrome collect"]);
    expect(aeroPlan.transactions.every((tx) => tx.to === manager)).toBe(true);
    const v4Plan = buildDecreasePositionActionPlan(snapshot({ ref: { protocol: "V4", chainId: 8453, tokenId: 88n } }), owner, "base", 50);
    expect(v4Plan.transactions).toHaveLength(1);
    expect(v4Plan.transactions[0]?.description).toContain("decrease");
    expect(v4Plan.transactions[0]?.to).toBe(addressesFor("base").v4PositionManager);
    expect(() => buildDecreasePositionActionPlan(snapshot({ ref: { protocol: "V2", chainId: 8453, tokenId: 1n } }), owner, "base", 50)).toThrow("V2");
  });

  it("repositions into an explicit range snapped to the pool spacing", () => {
    const position = snapshot();
    const target = targetRangeFromTicks(position, 130, 1_030);
    expect(target).toEqual({ tickLower: 200, tickUpper: 1_000 });
    const plan = buildRebalancePositionActionPlan(position, owner, "base", undefined, undefined, target);
    expect(plan.range).toMatchObject({ tickLower: 200, tickUpper: 1_000, previousTickLower: -200, previousTickUpper: 200, currentTick: 0 });
    expect(plan.range?.preset).toBeUndefined();
    expect(plan.notices[0]).toContain("custom range");
    expect(plan.transactions.at(-1)?.description).toBe("NFPM.mint");
    expect(() => targetRangeFromTicks(position, 400, 200)).toThrow("minimum price must be below");
    expect(() => targetRangeFromTicks(position, -200, 200)).toThrow("differs from the current one");
  });

  it("sizes the rebalance swap from the target range instead of always halving", () => {
    const position = snapshot();
    const centred = planRangeSwap(position, 1_000_000n, 1_000_000n, -200, 200);
    expect(centred).toBeUndefined();
    const above = planRangeSwap(position, 1_000_000n, 1_000_000n, 200, 600);
    expect(above?.tokenIn).toBe(1);
    expect(above?.amountIn).toBeGreaterThan(990_000n);
    const below = planRangeSwap(position, 1_000_000n, 1_000_000n, -600, -200);
    expect(below?.tokenIn).toBe(0);
    expect(below?.amountIn).toBeGreaterThan(990_000n);
    const oneSided = planRangeSwap(position, 0n, 2_000_000n, -200, 200);
    expect(oneSided?.tokenIn).toBe(1);
    expect(oneSided!.amountIn).toBeGreaterThan(950_000n);
    expect(oneSided!.amountIn).toBeLessThan(1_050_000n);
  });

  it("prices a reposition mint at the post-swap pool price", () => {
    const position = snapshot();
    const shifted = BigInt(TickMath.getSqrtRatioAtTick(120).toString());
    const plan = buildRebalancePositionActionPlan(position, owner, "base", {
      venue: "uniswap-v3",
      router: addressesFor("base").swapRouter02,
      tokenIn: position.token1.address,
      tokenOut: position.token0.address,
      amountIn: 500_000n,
      minimumAmountOut: 400_000n,
      fee: position.fee,
      postSwapSqrtPriceX96: shifted,
    }, undefined, { tickLower: 0, tickUpper: 400 });
    expect(plan.range?.swap).toEqual({ tokenIn: position.token1.symbol, tokenOut: position.token0.symbol, amountIn: "500000", minimumAmountOut: "400000" });
    expect(plan.range?.currentTick).toBe(0);
    expect(plan.notices[2]).toContain("swapped so both tokens fit");
  });

  it("settles a Base V3 exit to native ETH through the position's own pool", () => {
    const position = snapshot();
    const context = poolContext(position, "base");
    expect(context.quoteIsToken0).toBe(true);
    expect(supportsEthSettlement(position, context)).toBe(true);
    const plan = buildEthSettlement(buildPositionActionPlan(position, owner, "base", "withdraw"), position, context, { memeToSwap: 1_500_000n, minimumSwapOut: 700_000n });
    const descriptions = plan.transactions.map((tx) => tx.description);
    expect(descriptions[0]).toContain("decreaseLiquidity 100%");
    expect(descriptions.some((entry) => entry.startsWith("ERC20.approve"))).toBe(true);
    expect(descriptions.some((entry) => entry.includes("exact-in"))).toBe(true);
    expect(descriptions.at(-1)).toContain("WETH.withdraw");
    expect(plan.settlement).toEqual({ asset: "ETH", minimumAmountWei: String(((1_000_000n + 10_000n) * 9_850n) / 10_000n + 700_000n), marketSymbol: position.token1.symbol });
    expect(plan.allowedTargets).toContain(addressesFor("base").swapRouter02);
  });

  it("settles an Aerodrome exit through the Slipstream router", () => {
    const manager = "0x827922686190790b37229fd06084350E74485b72" as const;
    const position = snapshot({ venue: "aerodrome-slipstream", positionManager: manager, ref: { protocol: "V3", chainId: 8453, tokenId: 12n, venue: "aerodrome-slipstream", positionManager: manager } });
    const context = poolContext(position, "base");
    expect(context.aerodrome?.id).toBe("legacy");
    const plan = buildEthSettlement(buildPositionActionPlan(position, owner, "base", "withdraw"), position, context, { memeToSwap: 1_500_000n, minimumSwapOut: 700_000n });
    expect(plan.transactions.some((tx) => tx.description.startsWith("Aerodrome exact-in"))).toBe(true);
    expect(plan.transactions.at(-1)?.description).toContain("WETH.withdraw");
    expect(plan.allowedTargets).toContain("0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5");
  });

  it("does not offer ETH settlement to V4 or non-ETH pairs", () => {
    const v4 = snapshot({ ref: { protocol: "V4", chainId: 8453, tokenId: 88n } });
    expect(supportsEthSettlement(v4, poolContext(v4, "base"))).toBe(false);
    const usdc = addressesFor("base").usdc!;
    const stable = snapshot({ token0: { address: usdc, symbol: "USDC", decimals: 6 } });
    const context = poolContext(stable, "base");
    expect(context.quoteIsToken0).toBeUndefined();
    expect(supportsEthSettlement(stable, context)).toBe(false);
  });

  it("zaps fresh ETH into any V3 position through its own pool", () => {
    const position = snapshot();
    const context = poolContext(position, "base");
    const plan = buildIncreaseFromEthPlan(position, owner, "base", context, 1_000_000n, { amountIn: 500_000n, minimumAmountOut: 480_000n, postSwapSqrtPriceX96: position.sqrtPriceX96 });
    const descriptions = plan.transactions.map((tx) => tx.description);
    expect(descriptions[0]).toContain("exact-in");
    expect(BigInt(plan.transactions[0]!.value)).toBe(500_000n);
    expect(descriptions.at(-1)).toBe("NFPM.increaseLiquidity");
    expect(BigInt(plan.transactions.at(-1)!.value)).toBeGreaterThan(0n);
    expect(plan.funding).toMatchObject({ amountWei: "1000000", quoteSymbol: "ETH", memeSymbol: position.token1.symbol });
    expect(plan.transactions.some((tx) => tx.to === addressesFor("base").weth)).toBe(false);
    expect(plan.allowedTargets).toContain(addressesFor("base").swapRouter02);
  });

  it("zaps fresh ETH into an Aerodrome position by wrapping first", () => {
    const manager = "0x827922686190790b37229fd06084350E74485b72" as const;
    const position = snapshot({ venue: "aerodrome-slipstream", positionManager: manager, ref: { protocol: "V3", chainId: 8453, tokenId: 12n, venue: "aerodrome-slipstream", positionManager: manager } });
    const context = poolContext(position, "base");
    const plan = buildIncreaseFromEthPlan(position, owner, "base", context, 1_000_000n, { amountIn: 500_000n, minimumAmountOut: 480_000n, postSwapSqrtPriceX96: position.sqrtPriceX96 });
    const descriptions = plan.transactions.map((tx) => tx.description);
    expect(descriptions[0]).toContain("WETH.deposit");
    expect(descriptions.some((entry) => entry.startsWith("Aerodrome exact-in"))).toBe(true);
    expect(descriptions.at(-1)).toBe("Aerodrome increaseLiquidity");
    expect(plan.funding?.quoteSymbol).toBe("WETH");
  });

  it("does not require the catalog to manage a position", () => {
    const stranger = snapshot({ token1: { address: "0x3333333333333333333333333333333333333333", symbol: "STRANGER", decimals: 18 }, pool: "0x4444444444444444444444444444444444444444" });
    expect(positionPoolIsConfigured(stranger, activeMarkets("base"))).toBe(false);
    expect(buildPositionActionPlan(stranger, owner, "base", "collect").transactions).toHaveLength(1);
    expect(buildDecreasePositionActionPlan(stranger, owner, "base", 10).kind).toBe("decrease");
    const context = poolContext(stranger, "base");
    expect(context.swapRoute?.venue).toBe("uniswap-v3");
    expect(supportsEthSettlement(stranger, context)).toBe(true);
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

function allocationPlan(
  position: PositionSnapshot,
  protocol: "V2" | "V3" | "V4",
  venue: "uniswap-v2" | "uniswap-v3" | "uniswap-v4" | "aerodrome-slipstream",
  liquidityTarget: `0x${string}`,
  mintDescription: string,
): AllocationPlan {
  const market = activeMarkets("base").find((candidate) => candidate.protocol === "V3")!;
  return {
    kind: "allocate",
    owner,
    chain: "base",
    chainId: 8453,
    amountWei: "100000000000000000",
    serviceFeeBps: 0,
    serviceFeeWei: "0",
    netAllocationWei: "100000000000000000",
    expectedConfirmations: 1,
    execution: "wallet_transactions",
    atomic: false,
    createdAt: new Date(0).toISOString(),
    expiresAt: new Date(60_000).toISOString(),
    markets: [{
      marketId: market.id,
      symbol: market.symbol,
      protocol,
      pool: (protocol === "V4" ? position.poolId : position.pool) ?? position.pool,
      venue,
      liquidityTarget,
      quoteSymbol: protocol === "V4" ? "ETH" : "WETH",
      budgetWei: "100000000000000000",
      swapInWei: "50000000000000000",
      quotedMemeOut: "510000",
      minimumMemeOut: "500000",
      mintQuote: "50000000000000000",
      mintMeme: "500000",
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      leftoverQuote: "0",
      leftoverMeme: "0",
    }],
    transactions: [
      { to: addressesFor("base").weth, data: "0xd0e30db0", value: "100000000000000000", description: "WETH.deposit" },
      { to: liquidityTarget, data: "0x01", value: "0", description: mintDescription },
    ],
    allowedTargets: [addressesFor("base").weth, liquidityTarget, market.token],
    notices: [],
  };
}
