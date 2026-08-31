import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { activeStableVaults, getStableCatalog, type StableCatalog } from "../vaults/catalog.js";

/**
 * Deterministic stable-vault curator. Collects one observation per run from
 * the Morpho API, keeps a rolling history, and turns policy gates into hold /
 * review / pause calls. Pauses are the only automated catalog action; adding
 * or replacing vaults stays a reviewed release.
 */

export type VaultObservation = {
  at: string;
  vaultId: string;
  totalAssetsUsd: number | null;
  netApy: number | null;
  timelockSeconds: number | null;
};

export type VaultEvaluation = {
  vaultId: string;
  name: string;
  curatorName: string;
  incumbent: boolean;
  recommendation: "hold" | "review" | "pause";
  reasons: string[];
  summary: {
    observations: number;
    latestTotalAssetsUsd: number | null;
    medianTotalAssetsUsd: number | null;
    totalAssetsDrop24hPct: number | null;
    medianNetApyPct: number | null;
    latestTimelockHours: number | null;
  };
};

export type VaultReport = {
  version: 1;
  role: "vault-curator";
  generatedAt: string;
  catalogVersion: number;
  evaluations: VaultEvaluation[];
};

export const VAULT_POLICY = {
  minimumTotalAssetsUsd: 50_000_000,
  pauseTotalAssetsUsd: 20_000_000,
  maximumDrop24hPct: 30,
  pauseDrop24hPct: 50,
  minimumMedianNetApyPct: 1,
  minimumTimelockHours: 24,
  historyLimit: 240,
} as const;

const MORPHO_ENDPOINT = "https://blue-api.morpho.org/graphql";

async function fetchVaultStates(addresses: string[]): Promise<Map<string, { totalAssetsUsd: number | null; netApy: number | null; timelock: number | null }>> {
  const list = addresses.map((address) => JSON.stringify(address)).join(",");
  const query = `{
  vaults(first: ${addresses.length}, where: { address_in: [${list}], chainId_in: [8453] }) {
    items { address state { netApy totalAssetsUsd timelock } }
  }
}`;
  const response = await fetch(MORPHO_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`Morpho API ${response.status}`);
  const payload = await response.json() as {
    data?: { vaults?: { items?: Array<{ address: string; state?: { netApy?: number; totalAssetsUsd?: number; timelock?: number } }> } };
  };
  return new Map((payload.data?.vaults?.items ?? []).map((row) => [row.address.toLowerCase(), {
    totalAssetsUsd: row.state?.totalAssetsUsd ?? null,
    netApy: row.state?.netApy ?? null,
    timelock: row.state?.timelock ?? null,
  }]));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function evaluateVault(
  vault: { id: string; name: string; curatorName: string; status: string },
  history: VaultObservation[],
): VaultEvaluation {
  const latest = history.at(-1) ?? null;
  const tvls = history.map((row) => row.totalAssetsUsd).filter((value): value is number => value !== null);
  const apys = history.map((row) => row.netApy).filter((value): value is number => value !== null);
  const latestTvl = latest?.totalAssetsUsd ?? null;
  const dayAgoCutoff = Date.now() - 24 * 3600_000;
  const dayAgo = history.find((row) => Date.parse(row.at) >= dayAgoCutoff)?.totalAssetsUsd ?? null;
  const drop = latestTvl !== null && dayAgo !== null && dayAgo > 0 ? ((dayAgo - latestTvl) / dayAgo) * 100 : null;
  const medianApyPct = apys.length ? (median(apys)! * 100) : null;
  const timelockHours = latest?.timelockSeconds !== null && latest?.timelockSeconds !== undefined
    ? latest.timelockSeconds / 3600
    : null;

  const reasons: string[] = [];
  let recommendation: VaultEvaluation["recommendation"] = "hold";
  // Missing provider data reports as unavailable, never as a failed gate.
  if (latestTvl === null) reasons.push("provider TVL data is unavailable");
  if (latestTvl !== null && latestTvl < VAULT_POLICY.minimumTotalAssetsUsd) {
    recommendation = "review";
    reasons.push(`vault TVL is below $${(VAULT_POLICY.minimumTotalAssetsUsd / 1e6).toFixed(0)}M`);
  }
  if (drop !== null && drop > VAULT_POLICY.maximumDrop24hPct) {
    recommendation = "review";
    reasons.push(`vault TVL fell ${drop.toFixed(0)}% in 24h`);
  }
  if (medianApyPct !== null && history.length >= 8 && medianApyPct < VAULT_POLICY.minimumMedianNetApyPct) {
    recommendation = "review";
    reasons.push(`median net APY is below ${VAULT_POLICY.minimumMedianNetApyPct}%`);
  }
  if (timelockHours !== null && timelockHours < VAULT_POLICY.minimumTimelockHours) {
    recommendation = "pause";
    reasons.push(`vault timelock is below ${VAULT_POLICY.minimumTimelockHours}h`);
  }
  if (latestTvl !== null && latestTvl < VAULT_POLICY.pauseTotalAssetsUsd) {
    recommendation = "pause";
    reasons.push(`vault TVL collapsed below $${(VAULT_POLICY.pauseTotalAssetsUsd / 1e6).toFixed(0)}M`);
  }
  if (drop !== null && drop > VAULT_POLICY.pauseDrop24hPct) {
    recommendation = "pause";
    reasons.push(`vault TVL fell ${drop.toFixed(0)}% in 24h`);
  }
  if (!reasons.length) reasons.push("all vault gates pass");

  return {
    vaultId: vault.id,
    name: vault.name,
    curatorName: vault.curatorName,
    incumbent: vault.status === "active",
    recommendation,
    reasons,
    summary: {
      observations: history.length,
      latestTotalAssetsUsd: latestTvl,
      medianTotalAssetsUsd: median(tvls),
      totalAssetsDrop24hPct: drop,
      medianNetApyPct: medianApyPct,
      latestTimelockHours: timelockHours,
    },
  };
}

export async function runVaultCurator(input: { stateDir: string; persist?: boolean; catalog?: StableCatalog }): Promise<VaultReport> {
  const catalog = input.catalog ?? getStableCatalog();
  const persist = input.persist ?? true;
  const historyPath = join(input.stateDir, "vault-history.jsonl");

  const states = await fetchVaultStates(catalog.vaults.map((vault) => vault.vault));
  const now = new Date().toISOString();
  const fresh: VaultObservation[] = catalog.vaults.map((vault) => {
    const state = states.get(vault.vault.toLowerCase());
    return {
      at: now,
      vaultId: vault.id,
      totalAssetsUsd: state?.totalAssetsUsd ?? null,
      netApy: state?.netApy ?? null,
      timelockSeconds: state?.timelock ?? null,
    };
  });

  let history: VaultObservation[] = [];
  try {
    history = (await readFile(historyPath, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as VaultObservation);
  } catch {
    history = [];
  }
  const combined = [...history, ...fresh];

  if (persist) {
    await mkdir(input.stateDir, { recursive: true, mode: 0o700 });
    const trimmed = combined.slice(-VAULT_POLICY.historyLimit * catalog.vaults.length);
    const pending = `${historyPath}.next`;
    await writeFile(pending, trimmed.map((row) => JSON.stringify(row)).join("\n") + "\n", { mode: 0o600 });
    await rename(pending, historyPath);
  }

  const evaluations = catalog.vaults.map((vault) =>
    evaluateVault(vault, combined.filter((row) => row.vaultId === vault.id)),
  );
  const report: VaultReport = {
    version: 1,
    role: "vault-curator",
    generatedAt: now,
    catalogVersion: catalog.version,
    evaluations,
  };

  if (persist) {
    await writeFile(join(input.stateDir, "stable-latest.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    await writeFile(join(input.stateDir, "stable-latest.md"), renderMarkdown(report), { mode: 0o600 });
    await appendFile(join(input.stateDir, "stable-runs.log"), `${now} ${evaluations.map((row) => `${row.vaultId}:${row.recommendation}`).join(" ")}\n`, { mode: 0o600 });
  }
  return report;
}

function renderMarkdown(report: VaultReport): string {
  const lines = [
    "# Wizzy stable vault curator",
    "",
    `Generated ${report.generatedAt}. The version-controlled vault catalog is the live index; pauses ship through the tested deployment path.`,
    "",
    "| Vault | Curator | Call | TVL | Median net APY | Timelock |",
    "|---|---|---|---:|---:|---:|",
  ];
  for (const row of report.evaluations) {
    const tvl = row.summary.latestTotalAssetsUsd === null ? "—" : `$${(row.summary.latestTotalAssetsUsd / 1e6).toFixed(0)}M`;
    const apy = row.summary.medianNetApyPct === null ? "—" : `${row.summary.medianNetApyPct.toFixed(2)}%`;
    const timelock = row.summary.latestTimelockHours === null ? "—" : `${row.summary.latestTimelockHours.toFixed(0)}h`;
    lines.push(`| ${row.name} | ${row.curatorName} | ${row.recommendation} | ${tvl} | ${apy} | ${timelock} |`);
  }
  return lines.join("\n") + "\n";
}
