import { formatEther } from "viem";
import { activeMarkets, chainCatalog } from "../markets/catalog.js";
import { activeSolanaMarkets } from "../markets/solana-catalog.js";

const BPS = 10_000n;

export const INDEX_CHAIN_SHARES_BPS = {
  base: 6_000,
  robinhood: 1_500,
  solana: 2_500,
} as const;

export type IndexChain = keyof typeof INDEX_CHAIN_SHARES_BPS;

export type IndexBreadthTier = {
  minimumAmountWei: string;
  constituentCount: number;
  marketIds: Record<IndexChain, string[]>;
};

export type MemeIndexBreadthPolicy = {
  breadthUnitWei: string;
  minimumAmountWei: string;
  maximumConstituents: number;
  chainSharesBps: typeof INDEX_CHAIN_SHARES_BPS;
  tiers: IndexBreadthTier[];
};

type RankedMarket = {
  chain: IndexChain;
  id: string;
  weightBps: number;
  indexWeightBps: number;
};

/**
 * Turns the configured chain floors and curator weights into one public index.
 * Every deposit starts with the strongest market on each network. Each further
 * index-sized unit adds the highest-weight remaining constituent.
 */
export function getMemeIndexBreadthPolicy(): MemeIndexBreadthPolicy {
  const byChain: Record<IndexChain, RankedMarket[]> = {
    base: rank("base", activeMarkets("base")),
    robinhood: rank("robinhood", activeMarkets("robinhood")),
    solana: rank("solana", activeSolanaMarkets()),
  };
  const selected = new Map<IndexChain, string[]>([
    ["base", [byChain.base[0]!.id]],
    ["robinhood", [byChain.robinhood[0]!.id]],
    ["solana", [byChain.solana[0]!.id]],
  ]);
  const remaining = (Object.values(byChain) as RankedMarket[][])
    .flatMap((markets) => markets.slice(1))
    .sort((a, b) => b.indexWeightBps - a.indexWeightBps || b.weightBps - a.weightBps || a.id.localeCompare(b.id));

  const breadthUnit = minimumForUnits(1);
  const tiers: IndexBreadthTier[] = [tier(breadthUnit, selected)];

  for (const [index, market] of remaining.entries()) {
    selected.get(market.chain)!.push(market.id);
    tiers.push(tier(minimumForUnits(index + 2), selected));
  }

  return {
    breadthUnitWei: breadthUnit.toString(),
    minimumAmountWei: breadthUnit.toString(),
    maximumConstituents: Object.values(byChain).reduce((sum, markets) => sum + markets.length, 0),
    chainSharesBps: INDEX_CHAIN_SHARES_BPS,
    tiers,
  };
}

export function selectMemeIndexMarkets(totalAmountWei: bigint): IndexBreadthTier {
  const policy = getMemeIndexBreadthPolicy();
  const minimum = BigInt(policy.minimumAmountWei);
  if (totalAmountWei < minimum) {
    throw new Error(`Minimum index deposit is ${trimEth(minimum)} ETH`);
  }
  return [...policy.tiers].reverse().find((tier) => totalAmountWei >= BigInt(tier.minimumAmountWei)) ?? policy.tiers[0]!;
}

function rank(chain: IndexChain, markets: Array<{ id: string; weightBps: number }>): RankedMarket[] {
  return markets
    .map((market) => ({
      chain,
      id: market.id,
      weightBps: market.weightBps,
      indexWeightBps: Math.round((market.weightBps * INDEX_CHAIN_SHARES_BPS[chain]) / 10_000),
    }))
    .sort((a, b) => b.weightBps - a.weightBps || a.id.localeCompare(b.id));
}

function tier(minimumAmountWei: bigint, selected: Map<IndexChain, string[]>): IndexBreadthTier {
  const marketIds = Object.fromEntries(
    (["base", "robinhood", "solana"] as const).map((chain) => [chain, [...selected.get(chain)!]]),
  ) as Record<IndexChain, string[]>;
  return {
    minimumAmountWei: minimumAmountWei.toString(),
    constituentCount: Object.values(marketIds).reduce((sum, ids) => sum + ids.length, 0),
    marketIds,
  };
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function minimumForUnits(units: number): bigint {
  const count = BigInt(units);
  const baseFloor = ceilDiv(BigInt(chainCatalog("base").minimumAllocationWei) * count * BPS, BigInt(INDEX_CHAIN_SHARES_BPS.base));
  const robinhoodFloor = ceilDiv(BigInt(chainCatalog("robinhood").minimumAllocationWei) * count * BPS, BigInt(INDEX_CHAIN_SHARES_BPS.robinhood));
  return baseFloor > robinhoodFloor ? baseFloor : robinhoodFloor;
}

function trimEth(value: bigint): string {
  return Number(formatEther(value)).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}
