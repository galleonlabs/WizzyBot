import { describe, expect, it } from "vitest";
import { TickMath } from "@uniswap/v3-sdk";
import type { PublicClient } from "viem";
import { activeMarkets } from "../src/markets/catalog.js";
import { planAllocation } from "../src/portfolio/allocation.js";

describe("ETH-funded market allocation", () => {
  it("uses native ETH for the swap and V3 mint without wrapping or approving WETH", async () => {
    const market = activeMarkets("robinhood").find((candidate) => candidate.symbol === "CASHCAT")!;
    const postSwapSqrtPriceX96 = BigInt(TickMath.getSqrtRatioAtTick(-90_000).toString());
    const client = {
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "token0") return market.token;
        if (functionName === "token1") return market.quoteToken;
        throw new Error(`unexpected read ${functionName}`);
      },
      simulateContract: async () => ({
        result: [220_000_000_000_000_000_000n, postSwapSqrtPriceX96, 0, 100_000n],
      }),
    } as unknown as PublicClient;

    const plan = await planAllocation({
      owner: "0x30154567d96eACa13F0Bd1A4150eD938f05b507C",
      chain: "robinhood",
      amountWei: 50_000_000_000_000_000n,
      marketId: market.id,
      client,
    });

    expect(plan.markets[0]?.quoteSymbol).toBe("ETH");
    expect(plan.transactions.map((transaction) => transaction.description)).toEqual([
      expect.stringContaining("v3 exact-in"),
      expect.stringContaining("ERC20.approve"),
      "NFPM.mint",
    ]);
    expect(plan.transactions[0]?.value).toBe("25000000000000000");
    expect(BigInt(plan.transactions[2]?.value ?? "0")).toBeGreaterThan(0n);
    expect(plan.transactions.some((transaction) => transaction.to.toLowerCase() === market.quoteToken.toLowerCase())).toBe(false);
  });
});
