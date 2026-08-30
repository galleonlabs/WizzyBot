import { hexToString, keccak256, stringToHex, toHex, type Hex } from "viem";
import { getCuratorConfig } from "../curator/config.js";
import type { MarketEvaluation } from "../curator/policy.js";
import type { CuratorReport } from "../curator/run.js";
import type { RegistryMarket } from "./registry.js";
import { initialRobinhoodRegistryMarkets, type RegistryPublishMarket } from "./publish.js";

export type AutonomousRegistryPlan =
  | { kind: "noop"; reason: string }
  | { kind: "pause"; reason: string; reasonHash: Hex }
  | { kind: "publish"; reason: string; markets: RegistryPublishMarket[] };

const TICK_SPACING_BY_FEE = new Map<number, number>([
  [100, 1],
  [500, 10],
  [3_000, 60],
  [10_000, 200],
]);

export function planAutonomousRobinhoodRegistry(input: {
  report: CuratorReport;
  currentMarkets?: readonly RegistryMarket[];
  now?: Date;
}): AutonomousRegistryPlan {
  const config = getCuratorConfig();
  const now = input.now ?? new Date();
  assertFreshReport(input.report, config.version, now);

  const current = input.currentMarkets?.length
    ? input.currentMarkets.map(toPublishMarket)
    : initialRobinhoodRegistryMarkets();
  const evaluations = new Map(
    input.report.evaluations
      .filter((row) => row.chain === "robinhood")
      .map((row) => [row.marketId, row]),
  );

  for (const market of current) {
    const id = decodeId(market.id);
    const evaluation = evaluations.get(id);
    if (!evaluation) throw new Error(`Curator report is missing current market ${id}`);
    if (evaluation.recommendation === "pause") {
      return {
        kind: "pause",
        reason: `${evaluation.symbol}: ${evaluation.reasons.join("; ")}`,
        reasonHash: reportReasonHash(input.report, id),
      };
    }
  }

  const candidates = new Map(
    config.candidates
      .filter((candidate) => candidate.chain === "robinhood")
      .map((candidate) => [candidate.id, candidate]),
  );
  const next = [...current];
  const replaced = new Set<string>();
  const replacements: string[] = [];

  for (const proposal of input.report.replacements.filter((row) => row.chain === "robinhood")) {
    if (replaced.has(proposal.incumbentMarketId) || replaced.has(proposal.candidateMarketId)) continue;
    const incumbentIndex = next.findIndex((market) => decodeId(market.id) === proposal.incumbentMarketId);
    if (incumbentIndex < 0) continue;
    const candidate = candidates.get(proposal.candidateMarketId);
    const candidateEvaluation = evaluations.get(proposal.candidateMarketId);
    const incumbentEvaluation = evaluations.get(proposal.incumbentMarketId);
    if (!candidate || candidateEvaluation?.recommendation !== "eligible" || !isReplaceable(incumbentEvaluation)) {
      throw new Error(`Curator replacement ${proposal.candidateMarketId} -> ${proposal.incumbentMarketId} is not policy-valid`);
    }
    const incumbent = next[incumbentIndex]!;
    const tickSpacing = TICK_SPACING_BY_FEE.get(candidate.feePips);
    if (!tickSpacing) throw new Error(`Unsupported curator fee tier ${candidate.feePips}`);
    next[incumbentIndex] = {
      id: stringToHex(candidate.id, { size: 32 }),
      token: candidate.token,
      pool: candidate.pool,
      weightBps: incumbent.weightBps,
      fee: candidate.feePips,
      tickSpacing,
      rangeWidthBps: incumbent.rangeWidthBps,
    };
    replaced.add(proposal.incumbentMarketId);
    replaced.add(proposal.candidateMarketId);
    replacements.push(`${proposal.incumbentSymbol} -> ${proposal.candidateSymbol}`);
  }

  assertValidSnapshot(next);
  if (!input.currentMarkets?.length) {
    return { kind: "publish", reason: "initialize the curator-selected Robinhood index", markets: next };
  }
  if (sameMarkets(current, next)) {
    return { kind: "noop", reason: "the onchain index already matches the curator decision" };
  }
  return { kind: "publish", reason: `apply curator replacements: ${replacements.join(", ")}`, markets: next };
}

function assertFreshReport(report: CuratorReport, expectedConfigVersion: number, now: Date): void {
  if (report.version !== 1 || report.role !== "curator") throw new Error("Invalid curator report");
  if (report.configVersion !== expectedConfigVersion) {
    throw new Error(`Curator config version ${report.configVersion} does not match ${expectedConfigVersion}`);
  }
  if (!Array.isArray(report.evaluations) || !Array.isArray(report.replacements)) throw new Error("Invalid curator report rows");
  const generatedAt = Date.parse(report.generatedAt);
  if (!Number.isFinite(generatedAt)) throw new Error("Curator report has an invalid generatedAt timestamp");
  const ageMs = now.getTime() - generatedAt;
  if (ageMs < -5 * 60_000) throw new Error("Curator report is from the future");
  if (ageMs > report.snapshotCadenceMinutes * 2 * 60_000) throw new Error("Curator report is stale");
}

function isReplaceable(evaluation: MarketEvaluation | undefined): boolean {
  return Boolean(evaluation?.incumbent && (evaluation.recommendation === "review" || evaluation.recommendation === "hold"));
}

function reportReasonHash(report: CuratorReport, marketId: string): Hex {
  return keccak256(toHex(`${report.generatedAt}:${marketId}:pause`));
}

function toPublishMarket(market: RegistryMarket): RegistryPublishMarket {
  return {
    id: stringToHex(market.id, { size: 32 }),
    token: market.token,
    pool: market.pool,
    weightBps: market.weightBps,
    fee: market.fee,
    tickSpacing: market.tickSpacing,
    rangeWidthBps: market.rangeWidthBps,
  };
}

function decodeId(id: Hex): string {
  return hexToString(id).replace(/\0+$/g, "");
}

function assertValidSnapshot(markets: readonly RegistryPublishMarket[]): void {
  if (!markets.length || markets.length > 32) throw new Error("Curator snapshot has an invalid market count");
  const ids = new Set<string>();
  for (const market of markets) {
    const id = decodeId(market.id);
    if (ids.has(id)) throw new Error(`Curator snapshot repeats ${id}`);
    ids.add(id);
  }
  const total = markets.reduce((sum, market) => sum + market.weightBps, 0);
  if (total !== 10_000) throw new Error(`Curator snapshot weights total ${total} bps`);
}

function sameMarkets(left: readonly RegistryPublishMarket[], right: readonly RegistryPublishMarket[]): boolean {
  return left.length === right.length && left.every((market, index) => {
    const other = right[index];
    return Boolean(other)
      && market.id.toLowerCase() === other!.id.toLowerCase()
      && market.token.toLowerCase() === other!.token.toLowerCase()
      && market.pool.toLowerCase() === other!.pool.toLowerCase()
      && market.weightBps === other!.weightBps
      && market.fee === other!.fee
      && market.tickSpacing === other!.tickSpacing
      && market.rangeWidthBps === other!.rangeWidthBps;
  });
}
