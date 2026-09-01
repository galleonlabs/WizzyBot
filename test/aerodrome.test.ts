import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { AERODROME_DEPLOYMENTS } from "../src/aerodrome/deployments.js";
import { exactInSlipstreamTx, mintSlipstreamTx } from "../src/aerodrome/calldata.js";
import { activeMarkets } from "../src/markets/catalog.js";
import { buildPositionActionPlan, buildRebalancePositionActionPlan } from "../src/portfolio/position-actions.js";
import { TREASURY } from "../src/constants.js";
import type { PositionSnapshot } from "../src/types.js";
import { AerodromeSlipstreamAdapter } from "../src/aerodrome/positions.js";

const owner = getAddress("0x1111111111111111111111111111111111111111");
const brett = activeMarkets("base").find((market) => market.symbol === "BRETT")!;
const deployment = AERODROME_DEPLOYMENTS.legacy;

describe("Aerodrome Slipstream", () => {
  it("keeps the official Base periphery addresses pinned", () => {
    expect(deployment.factory).toBe(getAddress("0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A"));
    expect(deployment.positionManager).toBe(getAddress("0x827922686190790b37229fd06084350E74485b72"));
    expect(deployment.quoter).toBe(getAddress("0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0"));
    expect(deployment.swapRouter).toBe(getAddress("0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5"));
  });

  it("routes BRETT through the reviewed Slipstream pool", () => {
    expect(brett.protocol).toBe("AERODROME_SLIPSTREAM");
    expect(brett.aerodromeDeployment).toBe("legacy");
    expect(brett.pool).toBe(getAddress("0x4e829F8A5213c42535AB84AA40BD4aDCCE9cBa02"));
    expect(brett.tickSpacing).toBe(200);
  });

  it("encodes the official Slipstream router and mint selectors", () => {
    const swap = exactInSlipstreamTx({
      router: deployment.swapRouter,
      tokenIn: brett.quoteToken,
      tokenOut: brett.token,
      tickSpacing: brett.tickSpacing,
      amountIn: 1n,
      amountOutMin: 1n,
      recipient: owner,
      deadlineSec: 60,
    });
    const mint = mintSlipstreamTx({
      positionManager: deployment.positionManager,
      token0: brett.quoteToken,
      token1: brett.token,
      tickSpacing: brett.tickSpacing,
      tickLower: -200,
      tickUpper: 200,
      amount0: 1n,
      amount1: 1n,
      recipient: owner,
      slippageBps: 150,
      deadlineSec: 60,
    });
    expect(swap.to).toBe(deployment.swapRouter);
    expect(swap.data.slice(0, 10)).toBe("0xa026383e");
    expect(mint.to).toBe(deployment.positionManager);
    expect(mint.data.slice(0, 10)).toBe("0xb5007d1f");
  });

  it("compounds and withdraws through the Aerodrome position manager", () => {
    const collect = buildPositionActionPlan(snapshot(), owner, "base", "collect", TREASURY);
    expect(collect.serviceFeeBps).toBe(0);
    expect(collect.transactions.map((tx) => tx.description)).toEqual(["Aerodrome collect"]);

    const compound = buildPositionActionPlan(snapshot(), owner, "base", "compound", TREASURY);
    expect(compound.transactions[0]?.description).toBe("Aerodrome collect");
    expect(compound.transactions.at(-1)?.description).toBe("Aerodrome increaseLiquidity");
    expect(compound.transactions.filter((tx) => tx.description.startsWith("ERC20.approve")).every((tx) => tx.data !== "0x")).toBe(true);
    expect(compound.transactions.every((tx) => compound.allowedTargets.includes(tx.to))).toBe(true);

    const withdraw = buildPositionActionPlan(snapshot(), owner, "base", "withdraw", TREASURY);
    expect(withdraw.transactions.map((tx) => tx.description)).toEqual([
      "Aerodrome decreaseLiquidity 100%",
      "Aerodrome collect",
      expect.stringContaining("ERC20.transfer"),
      expect.stringContaining("ERC20.transfer"),
      "Aerodrome burn empty position",
    ]);
    expect(withdraw.transactions[0]?.to).toBe(deployment.positionManager);
    expect(withdraw.transactions.at(-1)?.to).toBe(deployment.positionManager);
  });

  it("recentres an out-of-range Slipstream position through the reviewed Aerodrome router", () => {
    const position = {
      ...snapshot(),
      tickCurrent: 600,
      amount0: 0n,
      inRange: false,
      percentThroughRange: 100,
    };
    const plan = buildRebalancePositionActionPlan(position, owner, "base", TREASURY, {
      venue: "aerodrome-slipstream",
      router: deployment.swapRouter,
      tokenIn: position.token1.address,
      tokenOut: position.token0.address,
      amountIn: 900_000n,
      minimumAmountOut: 400_000n,
      tickSpacing: brett.tickSpacing,
    });

    expect(plan.range).toEqual({
      tickLower: 200,
      tickUpper: 1000,
      currentTick: 600,
      previousTickLower: -400,
      previousTickUpper: 400,
      preset: "balanced",
    });
    expect(plan.transactions.slice(0, 3).map((tx) => tx.description)).toEqual([
      "Aerodrome decreaseLiquidity 100%",
      "Aerodrome collect",
      "Aerodrome burn empty position",
    ]);
    expect(plan.transactions.some((tx) => tx.to === deployment.swapRouter && tx.description.includes("Aerodrome exact-in"))).toBe(true);
    expect(plan.transactions.at(-1)?.description).toBe("Aerodrome Slipstream mint");
    expect(plan.transactions.at(-1)?.to).toBe(deployment.positionManager);
    expect(plan.allowedTargets).toContain(deployment.swapRouter);
    expect(plan.transactions.every((tx) => plan.allowedTargets.includes(tx.to))).toBe(true);
    expect(plan.notices[0]).toContain("Aerodrome Slipstream");
  });

  it("discovers and values a self-custodied Slipstream NFT", async () => {
    const client = {
      readContract: async ({ functionName, address, args }: { functionName: string; address: string; args?: readonly unknown[] }) => {
        if (functionName === "balanceOf") return 1n;
        if (functionName === "tokenOfOwnerByIndex") return 91n;
        if (functionName === "positions") {
          return [0n, owner, brett.quoteToken, brett.token, 200, -400, 400, 1_000_000n, 0n, 0n, 10n, 20n] as const;
        }
        if (functionName === "ownerOf") return owner;
        if (functionName === "getPool") return brett.pool;
        if (functionName === "decimals") return 18;
        if (functionName === "symbol") return address.toLowerCase() === brett.quoteToken.toLowerCase() ? "WETH" : "BRETT";
        if (functionName === "slot0") return [2n ** 96n, 0, 0, 1, 1, true] as const;
        if (functionName === "fee") return 2_111;
        if (functionName === "nft") return deployment.positionManager;
        if (functionName === "feeGrowthGlobal0X128" || functionName === "feeGrowthGlobal1X128") return 0n;
        if (functionName === "ticks" && (args?.[0] === -400 || args?.[0] === 400)) {
          return [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0, true] as const;
        }
        throw new Error(`unexpected ${functionName}`);
      },
    };
    const adapter = new AerodromeSlipstreamAdapter(client as never, "legacy");
    const refs = await adapter.listPositions(owner);
    expect(refs).toEqual([expect.objectContaining({ tokenId: 91n, venue: "aerodrome-slipstream" })]);
    const position = await adapter.readPosition(91n);
    expect(position.pool).toBe(brett.pool);
    expect(position.positionManager).toBe(deployment.positionManager);
    expect(position.fee).toBe(2_111);
    expect(position.tickSpacing).toBe(200);
    expect(position.uncollected0).toBe(10n);
    expect(position.uncollected1).toBe(20n);
  });
});

function snapshot(): PositionSnapshot {
  return {
    ref: {
      protocol: "V3",
      chainId: 8453,
      tokenId: 91n,
      venue: "aerodrome-slipstream",
      positionManager: deployment.positionManager,
    },
    owner,
    token0: { address: brett.quoteToken, symbol: "WETH", decimals: 18 },
    token1: { address: brett.token, symbol: "BRETT", decimals: 18 },
    fee: 2_111,
    tickSpacing: 200,
    tickLower: -400,
    tickUpper: 400,
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
    pool: brett.pool,
    venue: "aerodrome-slipstream",
    positionManager: deployment.positionManager,
    factory: deployment.factory,
  };
}
