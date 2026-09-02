import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getCuratorConfig } from "./config.js";
import { evaluateMarket, proposeAdmissions, type CuratorSnapshot, type MarketEvaluation } from "./policy.js";
import { collectCuratorObservations } from "./sources.js";
import { discoverCuratorCandidates, type CuratorDiscovery } from "./discovery.js";

export type CuratorReport = {
  version: 1;
  role: "curator";
  generatedAt: string;
  configVersion: number;
  snapshotCadenceMinutes: number;
  evaluations: MarketEvaluation[];
  discoveries: CuratorDiscovery[];
  admissions: ReturnType<typeof proposeAdmissions>;
};

export function defaultCuratorStateDir(): string {
  const stateHome = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return process.env.UNABOT_CURATOR_STATE_DIR || join(stateHome, "unabot-curator");
}

async function readSnapshots(path: string, cutoff: number): Promise<CuratorSnapshot[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw.split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const snapshot = JSON.parse(line) as CuratorSnapshot;
          return snapshot.version === 1 && Date.parse(snapshot.observedAt) >= cutoff ? [snapshot] : [];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, path);
}

export function renderCuratorMarkdown(report: CuratorReport): string {
  const rows = [...report.evaluations].sort((a, b) => {
    if (a.chain !== b.chain) return a.chain.localeCompare(b.chain);
    if (a.incumbent !== b.incumbent) return a.incumbent ? -1 : 1;
    return (b.summary.medianFeeAprPct ?? -1) - (a.summary.medianFeeAprPct ?? -1);
  });
  const table = rows.map((row) => {
    const liquidity = row.summary.medianLiquidityUsd === null ? "—" : `$${Math.round(row.summary.medianLiquidityUsd).toLocaleString("en-US")}`;
    const volume = row.summary.medianVolume24hUsd === null ? "—" : `$${Math.round(row.summary.medianVolume24hUsd).toLocaleString("en-US")}`;
    const apr = row.summary.medianFeeAprPct === null ? "—" : `${row.summary.medianFeeAprPct.toFixed(1)}%`;
    return `| ${row.symbol} | ${row.chain} | ${row.incumbent ? "active" : "watch"} | ${row.recommendation} | ${row.quality.score}/100 (${row.quality.confidence}) | ${liquidity} | ${volume} | ${apr} | ${row.summary.historyHours.toFixed(0)}h |`;
  }).join("\n");
  const discoveries = report.discoveries.length
    ? report.discoveries.map((row) => `| ${row.symbol} | ${row.chain} | ${[...new Set(row.venues.map((venue) => venue.protocol))].join(" + ")} | ${row.kind === "venue" && row.executionReady ? `add to ${row.marketId}` : row.kind === "candidate" && row.executionReady ? "candidate" : "research"} | $${Math.round(row.liquidityUsd).toLocaleString("en-US")} | $${Math.round(row.volume24hUsd).toLocaleString("en-US")} | ${row.poolAgeDays.toFixed(0)}d | ${row.sourceUrl} |`).join("\n")
    : "| — | — | — | — | — | — | — | No new policy-qualified leads. |";
  const admissions = report.admissions.length
    ? report.admissions.map((row) => `- ${row.chain}: add ${row.candidateSymbol} (${row.qualityScore}/100 quality${row.estimatedCapacityUsd === null ? "" : `, $${Math.round(row.estimatedCapacityUsd).toLocaleString("en-US")} cautious entry capacity`})`).join("\n")
    : "- None.";
  return `# Wizzy market curator\n\nGenerated ${report.generatedAt}. The version-controlled market catalog remains the live market set. This report supplies evidence and policy-valid additions for the curator agent to apply through the normal tested deployment path. Fee pace is a trailing observation, not a promise or a standalone selection rule.\n\n| Market | Chain | Set | Call | LP quality | Median TVL | Median 24h volume | Median fee pace | History |\n|---|---|---:|---|---:|---:|---:|---:|---:|\n${table}\n\n## Discovery inventory\n\nDiscovery is intentionally broad. Indexed pools may sit below activation policy; that makes them observable, not depositable. Uniswap V2/V3/V4 and Aerodrome Slipstream leads remain research-only until their execution metadata is verified.\n\n| Token | Chain | Venues | Route | TVL | 24h volume | Pool age | Source |\n|---|---|---|---|---:|---:|---:|---|\n${discoveries}\n\n## Eligible additions\n\n${admissions}\n`;
}

export async function runCurator(options: { stateDir?: string; persist?: boolean; observedAt?: string } = {}): Promise<CuratorReport> {
  const config = getCuratorConfig();
  const observedAt = options.observedAt ?? new Date().toISOString();
  const stateDir = options.stateDir ?? defaultCuratorStateDir();
  const historyPath = join(stateDir, "history.jsonl");
  const [observations, discoveries] = await Promise.all([
    collectCuratorObservations(observedAt),
    discoverCuratorCandidates(observedAt),
  ]);
  const snapshot: CuratorSnapshot = { version: 1, observedAt, markets: observations };
  const cutoff = Date.parse(observedAt) - config.policy.historyDays * 86_400_000;
  const history = await readSnapshots(historyPath, cutoff);
  history.push(snapshot);
  const byMarket = new Map<string, typeof observations>();
  for (const row of history.flatMap((entry) => entry.markets)) {
    const rows = byMarket.get(row.marketId) ?? [];
    rows.push(row);
    byMarket.set(row.marketId, rows);
  }
  const evaluations = [...byMarket.values()].map((rows) => evaluateMarket(rows, config.policy));
  const report: CuratorReport = {
    version: 1,
    role: "curator",
    generatedAt: observedAt,
    configVersion: config.version,
    snapshotCadenceMinutes: config.policy.snapshotMinutes,
    evaluations,
    discoveries,
    admissions: proposeAdmissions(evaluations),
  };
  if (options.persist !== false) {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await Promise.all([
      writeAtomic(historyPath, `${history.map((entry) => JSON.stringify(entry)).join("\n")}\n`),
      writeAtomic(join(stateDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`),
      writeAtomic(join(stateDir, "latest.md"), renderCuratorMarkdown(report)),
    ]);
  }
  return report;
}
