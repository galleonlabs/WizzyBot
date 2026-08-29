import { describe, expect, it } from "vitest";
import { parseEther } from "viem";
import { getMemeIndexBreadthPolicy, selectMemeIndexMarkets } from "../src/portfolio/index-selection.js";

describe("meme index breadth", () => {
  it("starts with the strongest active market on every network", () => {
    const policy = getMemeIndexBreadthPolicy();
    expect(policy.tiers[0]).toMatchObject({
      constituentCount: 3,
      marketIds: {
        base: ["base-brett"],
        robinhood: ["robinhood-cashcat"],
        solana: ["solana-fartcoin"],
      },
    });
  });

  it("adds the highest index-weight market for each further viable unit", () => {
    const policy = getMemeIndexBreadthPolicy();
    expect(policy.tiers.map((tier) => ({ count: tier.constituentCount, ids: tier.marketIds }))).toEqual([
      {
        count: 3,
        ids: { base: ["base-brett"], robinhood: ["robinhood-cashcat"], solana: ["solana-fartcoin"] },
      },
      {
        count: 4,
        ids: { base: ["base-brett", "base-basecat"], robinhood: ["robinhood-cashcat"], solana: ["solana-fartcoin"] },
      },
      {
        count: 5,
        ids: { base: ["base-brett", "base-basecat"], robinhood: ["robinhood-cashcat"], solana: ["solana-fartcoin", "solana-useless"] },
      },
    ]);
  });

  it("selects breadth from the deposit and rejects uneconomic deposits", () => {
    const policy = getMemeIndexBreadthPolicy();
    const [core, broad, full] = policy.tiers;
    expect(BigInt(full!.minimumAmountWei)).toBe(parseEther("0.2"));
    expect(selectMemeIndexMarkets(BigInt(core!.minimumAmountWei)).constituentCount).toBe(3);
    expect(selectMemeIndexMarkets(BigInt(broad!.minimumAmountWei)).constituentCount).toBe(4);
    expect(selectMemeIndexMarkets(BigInt(full!.minimumAmountWei)).constituentCount).toBe(5);
    expect(() => selectMemeIndexMarkets(BigInt(policy.minimumAmountWei) - 1n)).toThrow("Minimum index deposit");
  });
});
