import type { CuratorPolicy } from "./config.js";

export type CuratorChain = "base" | "robinhood" | "solana";
export type CuratorRisk = "established" | "emerging" | "experimental";

export type CuratorObservation = {
  marketId: string;
  chain: CuratorChain;
  name: string;
  symbol: string;
  token: string;
  pool: string;
  protocol: string;
  incumbent: boolean;
  catalogStatus: "active" | "paused" | "watch";
  risk: CuratorRisk;
  identity: "reviewed" | "watch";
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  fees24hUsd: number | null;
  feeAprPct: number | null;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  marketCapUsd: number | null;
  poolAgeDays: number | null;
  holderCount: number | null;
  topHolderPct: number | null;
  socialLinks: number;
  securityAvailable: boolean;
  securityFlags: string[];
  sourceUrl: string | null;
  observedAt: string;
};

export type CuratorSnapshot = {
  version: 1;
  observedAt: string;
  markets: CuratorObservation[];
};

export type MarketHistorySummary = {
  marketId: string;
  observations: number;
  historyHours: number;
  observationCoveragePct: number;
  medianLiquidityUsd: number | null;
  minimumLiquidityUsd: number | null;
  liquidityDrop24hPct: number | null;
  medianVolume24hUsd: number | null;
  medianFeeAprPct: number | null;
  p90AbsPriceChange24hPct: number | null;
  latestMarketCapUsd: number | null;
  latestPoolAgeDays: number | null;
  latestHolderCount: number | null;
  latestTopHolderPct: number | null;
  latestSocialLinks: number;
  latestSecurityAvailable: boolean;
  identity: "reviewed" | "watch";
  securityFlags: string[];
};

export type MarketEvaluation = {
  marketId: string;
  chain: CuratorChain;
  symbol: string;
  incumbent: boolean;
  recommendation: "hold" | "review" | "pause" | "observe" | "eligible" | "reject";
  score: number | null;
  estimatedCapacityUsd: number | null;
  reasons: string[];
  summary: MarketHistorySummary;
};

export type ReplacementProposal = {
  chain: CuratorChain;
  candidateMarketId: string;
  candidateSymbol: string;
  incumbentMarketId: string;
  incumbentSymbol: string;
  scoreMargin: number;
};

function finite(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? null;
}

function median(values: Array<number | null>): number | null {
  return quantile(finite(values), 0.5);
}

function ageHours(first: string, last: string): number {
  return Math.max(0, (Date.parse(last) - Date.parse(first)) / 3_600_000);
}

export function summarizeMarketHistory(observations: CuratorObservation[], snapshotMinutes = 60): MarketHistorySummary {
  if (!observations.length) throw new Error("Cannot summarize empty market history");
  const ordered = [...observations].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const latest = ordered.at(-1)!;
  const latestAt = Date.parse(latest.observedAt);
  const prior24h = [...ordered].reverse().find((row) => latestAt - Date.parse(row.observedAt) >= 23 * 3_600_000);
  const liquidityDrop24hPct = latest.liquidityUsd !== null && prior24h?.liquidityUsd && prior24h.liquidityUsd > 0
    ? Math.max(0, ((prior24h.liquidityUsd - latest.liquidityUsd) / prior24h.liquidityUsd) * 100)
    : null;
  const historyHours = ageHours(ordered[0]!.observedAt, latest.observedAt);
  const expectedObservations = historyHours === 0 ? 1 : Math.floor(historyHours * 60 / snapshotMinutes) + 1;
  return {
    marketId: latest.marketId,
    observations: ordered.length,
    historyHours,
    observationCoveragePct: Math.min(100, ordered.length / expectedObservations * 100),
    medianLiquidityUsd: median(ordered.map((row) => row.liquidityUsd)),
    minimumLiquidityUsd: quantile(finite(ordered.map((row) => row.liquidityUsd)), 0),
    liquidityDrop24hPct,
    medianVolume24hUsd: median(ordered.map((row) => row.volume24hUsd)),
    medianFeeAprPct: median(ordered.map((row) => row.feeAprPct)),
    p90AbsPriceChange24hPct: quantile(finite(ordered.map((row) => row.priceChange24hPct === null ? null : Math.abs(row.priceChange24hPct))), 0.9),
    latestMarketCapUsd: latest.marketCapUsd,
    latestPoolAgeDays: latest.poolAgeDays,
    latestHolderCount: latest.holderCount,
    latestTopHolderPct: latest.topHolderPct,
    latestSocialLinks: latest.socialLinks,
    latestSecurityAvailable: latest.securityAvailable,
    identity: latest.identity,
    securityFlags: [...new Set(ordered.slice(-24).flatMap((row) => row.securityFlags))],
  };
}

function logScore(value: number | null, floor: number, ceiling: number): number {
  if (value === null || value <= floor) return 0;
  if (value >= ceiling) return 1;
  return (Math.log(value) - Math.log(floor)) / (Math.log(ceiling) - Math.log(floor));
}

function linearScore(value: number | null, floor: number, ceiling: number): number {
  if (value === null || value <= floor) return 0;
  if (value >= ceiling) return 1;
  return (value - floor) / (ceiling - floor);
}

function scoreMarket(summary: MarketHistorySummary, policy: CuratorPolicy): number {
  const feeEfficiency = 40 * logScore(summary.medianFeeAprPct, 5, 200);
  const capacity = 15 * logScore(summary.medianLiquidityUsd, policy.incumbentLiquidityUsd, 5_000_000);
  const history = 10 * linearScore(summary.historyHours, 24, policy.candidateProofDays * 24);
  const durability = 10 * linearScore(summary.latestPoolAgeDays, policy.minimumPoolAgeDays, 365);
  const distribution = 10 * linearScore(summary.latestHolderCount, policy.minimumHolderCount, 100_000);
  const identity = summary.identity === "reviewed" ? 10 : 0;
  const socials = 5 * linearScore(summary.latestSocialLinks, 0, 3);
  const volatilityPenalty = 15 * linearScore(summary.p90AbsPriceChange24hPct, 10, 50);
  return Math.round(Math.max(0, Math.min(100, feeEfficiency + capacity + history + durability + distribution + identity + socials - volatilityPenalty)));
}

function marketFloor(incumbent: boolean, policy: CuratorPolicy): number {
  return incumbent ? policy.incumbentLiquidityUsd : policy.minimumLiquidityUsd;
}

export function evaluateMarket(observations: CuratorObservation[], policy: CuratorPolicy): MarketEvaluation {
  if (!observations.length) throw new Error("Cannot evaluate empty market history");
  const latest = [...observations].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt)).at(-1)!;
  const summary = summarizeMarketHistory(observations, policy.snapshotMinutes);
  const reasons: string[] = [];
  const hardSecurityFailure = summary.securityFlags.length > 0;
  const collapsed = summary.liquidityDrop24hPct !== null && summary.liquidityDrop24hPct >= policy.maximumLiquidityDrop24hPct;
  const enoughCoverage = summary.observationCoveragePct >= 80;
  const enoughHistory = summary.historyHours >= policy.minimumHistoryHours && enoughCoverage;
  const proofComplete = summary.historyHours >= policy.candidateProofDays * 24 && enoughCoverage;
  const liquidityPass = summary.medianLiquidityUsd !== null && summary.medianLiquidityUsd >= marketFloor(latest.incumbent, policy);
  const volumePass = summary.medianVolume24hUsd !== null && summary.medianVolume24hUsd >= policy.minimumVolume24hUsd;
  const agePass = summary.latestPoolAgeDays !== null && summary.latestPoolAgeDays >= policy.minimumPoolAgeDays;
  const marketCapPass = summary.latestMarketCapUsd !== null && summary.latestMarketCapUsd >= policy.minimumMarketCapUsd;
  const holdersPass = summary.latestHolderCount !== null && summary.latestHolderCount >= policy.minimumHolderCount;
  const concentrationPass = summary.latestTopHolderPct === null || summary.latestTopHolderPct <= policy.maximumTopHolderPct;
  const identityPass = summary.identity === "reviewed";
  const securityPass = summary.latestSecurityAvailable;
  const score = enoughHistory ? scoreMarket(summary, policy) : null;
  const estimatedCapacityUsd = summary.medianLiquidityUsd === null ? null : summary.medianLiquidityUsd * policy.maximumPoolAllocationBps / 10_000;

  if (hardSecurityFailure) reasons.push(`security: ${summary.securityFlags.join(", ")}`);
  if (collapsed) reasons.push(`pool liquidity fell ${summary.liquidityDrop24hPct!.toFixed(0)}% in 24h`);
  if (!agePass) reasons.push(summary.latestPoolAgeDays === null ? `pool age unavailable; needs ${policy.minimumPoolAgeDays} tracked days` : `pool needs ${policy.minimumPoolAgeDays} days of history`);
  if (!liquidityPass) reasons.push(`median pool liquidity is below $${marketFloor(latest.incumbent, policy).toLocaleString()}`);
  if (!volumePass) reasons.push(`median daily volume is below $${policy.minimumVolume24hUsd.toLocaleString()}`);
  if (!marketCapPass) reasons.push(`market cap is below $${policy.minimumMarketCapUsd.toLocaleString()} or unavailable`);
  if (!holdersPass) reasons.push(`holder count is below ${policy.minimumHolderCount.toLocaleString()} or unavailable`);
  if (!concentrationPass) reasons.push(`largest holder exceeds ${policy.maximumTopHolderPct}%`);
  if (!identityPass) reasons.push("token identity and social history still need review");
  if (!securityPass) reasons.push("security provider data is unavailable");
  if (!enoughCoverage && summary.historyHours > 0) reasons.push("snapshot coverage is below 80%");
  if (!enoughHistory) reasons.push(`needs ${policy.minimumHistoryHours} hours of curator history`);
  else if (!latest.incumbent && !proofComplete) reasons.push(`candidate needs ${policy.candidateProofDays} tracked days`);

  let recommendation: MarketEvaluation["recommendation"];
  if (hardSecurityFailure || collapsed) recommendation = latest.incumbent ? "pause" : "reject";
  else if (!enoughHistory) recommendation = "observe";
  else if (latest.incumbent) recommendation = liquidityPass && volumePass && agePass && securityPass ? "hold" : "review";
  else if (!proofComplete || !liquidityPass || !volumePass || !agePass || !marketCapPass || !holdersPass || !concentrationPass || !identityPass || !securityPass) recommendation = "observe";
  else recommendation = score !== null && score >= policy.eligibleScore ? "eligible" : "observe";

  if (!reasons.length) reasons.push(latest.incumbent ? "all maintained-market gates pass" : "all candidate gates pass");
  return { marketId: latest.marketId, chain: latest.chain, symbol: latest.symbol, incumbent: latest.incumbent, recommendation, score, estimatedCapacityUsd, reasons, summary };
}

export function proposeReplacements(evaluations: MarketEvaluation[], policy: CuratorPolicy): ReplacementProposal[] {
  const proposals: ReplacementProposal[] = [];
  for (const candidate of evaluations.filter((row) => !row.incumbent && row.recommendation === "eligible" && row.score !== null)) {
    const incumbent = evaluations
      .filter((row) => row.incumbent && row.chain === candidate.chain && row.score !== null && row.recommendation !== "pause")
      .sort((a, b) => a.score! - b.score!)[0];
    if (!incumbent) continue;
    const scoreMargin = candidate.score! - incumbent.score!;
    if (scoreMargin < policy.replacementMarginPoints) continue;
    proposals.push({
      chain: candidate.chain,
      candidateMarketId: candidate.marketId,
      candidateSymbol: candidate.symbol,
      incumbentMarketId: incumbent.marketId,
      incumbentSymbol: incumbent.symbol,
      scoreMargin,
    });
  }
  return proposals;
}
