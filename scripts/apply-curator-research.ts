#!/usr/bin/env bun
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CuratorResearchDecisionSchema, planCentralizedCatalogUpdate } from "../src/curator/catalog-update.js";
import { parseCuratorConfig } from "../src/curator/config.js";
import type { CuratorReport } from "../src/curator/run.js";
import { parseMarketCatalog } from "../src/markets/catalog.js";

function argument(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const stateDir = process.env.UNABOT_CURATOR_STATE_DIR ?? join(process.env.HOME ?? "", ".local/state/unabot-curator");
const reportPath = argument("--report") ?? join(stateDir, "latest.json");
const decisionPath = argument("--decision") ?? join(stateDir, "research-latest.json");
const configPath = "src/config/curator.json";
const catalogPath = "src/config/markets.json";
const [reportBytes, decisionBytes, configBytes, catalogBytes] = await Promise.all([
  readFile(reportPath),
  readFile(decisionPath),
  readFile(configPath),
  readFile(catalogPath),
]);
const report = JSON.parse(reportBytes.toString("utf8")) as CuratorReport;
const decision = CuratorResearchDecisionSchema.parse(JSON.parse(decisionBytes.toString("utf8")));
const reportAgeMs = Date.now() - Date.parse(report.generatedAt);
if (!Number.isFinite(reportAgeMs) || reportAgeMs < -5 * 60_000 || reportAgeMs > report.snapshotCadenceMinutes * 2 * 60_000) {
  throw new Error("Curator research report is stale or invalid");
}
const result = planCentralizedCatalogUpdate({
  report,
  decision,
  curatorConfig: parseCuratorConfig(JSON.parse(configBytes.toString("utf8"))),
  catalog: parseMarketCatalog(JSON.parse(catalogBytes.toString("utf8"))),
  today: new Date().toISOString().slice(0, 10),
});

if (result.changedFiles.includes(configPath)) {
  await writeAtomic(configPath, `${JSON.stringify(result.curatorConfig, null, 2)}\n`);
}
if (result.changedFiles.includes(catalogPath)) {
  await writeAtomic(catalogPath, `${JSON.stringify(result.catalog, null, 2)}\n`);
}
const audit = {
  appliedAt: new Date().toISOString(),
  reportGeneratedAt: report.generatedAt,
  verdict: decision.verdict,
  summary: decision.summary,
  changedFiles: result.changedFiles,
  appliedReviews: result.appliedReviews,
  appliedNominations: result.appliedNominations,
  appliedVenues: result.appliedVenues,
  appliedAdmissions: result.appliedAdmissions,
  appliedPauses: result.appliedPauses,
};
await writeAtomic(join(stateDir, "research-applied-latest.json"), `${JSON.stringify(audit, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(audit)}\n`);

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, path);
}
