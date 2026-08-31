import { describe, expect, it } from "vitest";
import { parseEther } from "viem";
import {
  getMemeIndexBreadthPolicy,
  getRobinhoodIndexBreadthPolicy,
  selectMemeIndexMarkets,
  selectRobinhoodIndexMarkets,
} from "../src/portfolio/index-selection.js";
import { activeMarkets } from "../src/markets/catalog.js";
import { activeSolanaMarkets } from "../src/markets/solana-catalog.js";

function byIndexWeight(markets: Array<{ id: string; weightBps: number }>): string[] {
  return markets.slice().sort((a, b) => b.weightBps - a.weightBps || a.id.localeCompare(b.id)).map((market) => market.id);
}

describe("meme index breadth", () => {
  it("starts with the strongest active market on every network", () => {
    const policy = getMemeIndexBreadthPolicy();
    expect(policy.tiers[0]).toMatchObject({
      constituentCount: 3,
      marketIds: {
        base: [byIndexWeight(activeMarkets("base"))[0]],
        robinhood: [byIndexWeight(activeMarkets("robinhood"))[0]],
        solana: [byIndexWeight(activeSolanaMarkets())[0]],
      },
    });
  });

  it("adds one market per further viable unit up to every active constituent", () => {
    const policy = getMemeIndexBreadthPolicy();
    const totalActive = activeMarkets("base").length + activeMarkets("robinhood").length + activeSolanaMarkets().length;
    expect(policy.maximumConstituents).toBe(totalActive);
    policy.tiers.forEach((tier, index) => {
      expect(tier.constituentCount).toBe(3 + index);
      const ids = Object.values(tier.marketIds).flat();
      expect(ids).toHaveLength(tier.constituentCount);
      if (index > 0) {
        const previous = Object.values(policy.tiers[index - 1]!.marketIds).flat();
        expect(ids).toEqual(expect.arrayContaining(previous));
      }
    });
    expect(policy.tiers.at(-1)!.constituentCount).toBe(totalActive);
  });

  it("selects breadth from the deposit and rejects uneconomic deposits", () => {
    const policy = getMemeIndexBreadthPolicy();
    const [core, broad, full] = policy.tiers;
    expect(selectMemeIndexMarkets(BigInt(core!.minimumAmountWei)).constituentCount).toBe(core!.constituentCount);
    expect(selectMemeIndexMarkets(BigInt(broad!.minimumAmountWei)).constituentCount).toBe(broad!.constituentCount);
    expect(selectMemeIndexMarkets(BigInt(full!.minimumAmountWei)).constituentCount).toBe(full!.constituentCount);
    expect(() => selectMemeIndexMarkets(BigInt(policy.minimumAmountWei) - 1n)).toThrow("Minimum index deposit");
  });

  it("publishes the curator-selected Robinhood index without changing the hidden multi-chain policy", () => {
    const policy = getRobinhoodIndexBreadthPolicy();
    const actives = activeMarkets("robinhood");
    const sleeveIds = actives.filter((market) => market.sleeve).map((market) => market.id).sort();
    const ordinaries = byIndexWeight(actives.filter((market) => !market.sleeve));
    expect(policy.chain).toBe("robinhood");
    expect(policy.tiers.map((tier) => tier.constituentCount)).toEqual(ordinaries.map((_, index) => index + 1 + sleeveIds.length));
    expect(policy.tiers.at(-1)?.marketIds).toEqual([...ordinaries, ...sleeveIds]);
    for (const tier of policy.tiers) {
      for (const sleeveId of sleeveIds) expect(tier.marketIds).toContain(sleeveId);
    }
    expect(BigInt(policy.minimumAmountWei)).toBe(parseEther("0.02"));
    expect(BigInt(policy.tiers.at(-1)!.minimumAmountWei)).toBe(parseEther("0.02") * BigInt(ordinaries.length));
    expect(selectRobinhoodIndexMarkets(parseEther("0.10")).constituentCount).toBe(Math.min(5, ordinaries.length) + sleeveIds.length);
    expect(selectRobinhoodIndexMarkets(parseEther("1")).constituentCount).toBe(ordinaries.length + sleeveIds.length);
    expect(() => selectRobinhoodIndexMarkets(parseEther("0.019"))).toThrow("Minimum Robinhood index deposit");
  });
});
