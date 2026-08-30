import { describe, expect, it } from "vitest";
import { parseEther } from "viem";
import {
  getMemeIndexBreadthPolicy,
  getRobinhoodIndexBreadthPolicy,
  selectMemeIndexMarkets,
  selectRobinhoodIndexMarkets,
} from "../src/portfolio/index-selection.js";

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
    expect(policy.tiers[1]).toMatchObject({
      constituentCount: 4,
      marketIds: { base: ["base-brett", "base-basecat"], robinhood: ["robinhood-cashcat"], solana: ["solana-fartcoin"] },
    });
    expect(policy.tiers[2]).toMatchObject({
      constituentCount: 5,
      marketIds: { base: ["base-brett", "base-basecat"], robinhood: ["robinhood-cashcat"], solana: ["solana-fartcoin", "solana-useless"] },
    });
    expect(policy.maximumConstituents).toBe(10);
  });

  it("selects breadth from the deposit and rejects uneconomic deposits", () => {
    const policy = getMemeIndexBreadthPolicy();
    const [core, broad, full] = policy.tiers;
    expect(selectMemeIndexMarkets(BigInt(core!.minimumAmountWei)).constituentCount).toBe(3);
    expect(selectMemeIndexMarkets(BigInt(broad!.minimumAmountWei)).constituentCount).toBe(4);
    expect(selectMemeIndexMarkets(BigInt(full!.minimumAmountWei)).constituentCount).toBe(5);
    expect(() => selectMemeIndexMarkets(BigInt(policy.minimumAmountWei) - 1n)).toThrow("Minimum index deposit");
  });

  it("publishes a six-market Robinhood launch index without changing the hidden multi-chain policy", () => {
    const policy = getRobinhoodIndexBreadthPolicy();
    expect(policy.chain).toBe("robinhood");
    expect(policy.tiers.map((tier) => tier.constituentCount)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(policy.tiers.at(-1)?.marketIds).toEqual([
      "robinhood-cashcat",
      "robinhood-pons",
      "robinhood-ai",
      "robinhood-chump",
      "robinhood-stonkbroker",
      "robinhood-ponsguy",
    ]);
    expect(BigInt(policy.minimumAmountWei)).toBe(parseEther("0.05"));
    expect(BigInt(policy.tiers.at(-1)!.minimumAmountWei)).toBe(parseEther("0.3"));
    expect(selectRobinhoodIndexMarkets(parseEther("0.25")).constituentCount).toBe(5);
    expect(selectRobinhoodIndexMarkets(parseEther("1")).constituentCount).toBe(6);
    expect(() => selectRobinhoodIndexMarkets(parseEther("0.049"))).toThrow("Minimum Robinhood index deposit");
  });
});
