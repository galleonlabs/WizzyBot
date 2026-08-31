import type { StableCatalog } from "../vaults/catalog.js";
import type { VaultReport } from "./vault-run.js";

export type StableCatalogUpdate = {
  catalog: StableCatalog;
  changed: boolean;
  appliedPauses: string[];
};

/**
 * Applies the deterministic report's pause calls to the stable catalog: the
 * paused vault is marked unavailable and its weight is redistributed
 * proportionally so active weights stay at 10,000 bps. Pausing is the only
 * automated action; activation and replacement are reviewed releases.
 */
export function planStableCatalogUpdate(input: { report: VaultReport; catalog: StableCatalog; today: string }): StableCatalogUpdate {
  if (input.report.version !== 1 || input.report.role !== "vault-curator") throw new Error("Invalid vault curator report");
  if (input.report.catalogVersion !== input.catalog.version) throw new Error("Vault report does not match the current catalog");
  const ageMs = Date.now() - Date.parse(input.report.generatedAt);
  if (!Number.isFinite(ageMs) || ageMs < -5 * 60_000 || ageMs > 12 * 3600_000) throw new Error("Vault report is stale");

  const catalog = structuredClone(input.catalog);
  const appliedPauses: string[] = [];
  for (const evaluation of input.report.evaluations) {
    if (!evaluation.incumbent || evaluation.recommendation !== "pause") continue;
    const vault = catalog.vaults.find((row) => row.id === evaluation.vaultId);
    if (!vault || vault.status !== "active") continue;
    const remaining = catalog.vaults.filter((row) => row.status === "active" && row.id !== vault.id);
    if (!remaining.length) throw new Error(`Refusing to pause ${vault.id}: it is the last active vault`);
    vault.status = "paused";
    redistributeWeight(remaining, vault.weightBps);
    appliedPauses.push(`${vault.id}:${evaluation.reasons.join("; ")}`);
  }
  if (appliedPauses.length) {
    catalog.version += 1;
    catalog.updatedAt = input.today;
  }
  return { catalog, changed: appliedPauses.length > 0, appliedPauses };
}

function redistributeWeight(vaults: Array<{ id: string; weightBps: number }>, freedBps: number): void {
  const remainingTotal = vaults.reduce((sum, vault) => sum + vault.weightBps, 0);
  const target = remainingTotal + freedBps;
  const shares = vaults.map((vault) => {
    const exact = (vault.weightBps * target) / remainingTotal;
    return { vault, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let leftover = target - shares.reduce((sum, share) => sum + share.floor, 0);
  shares.sort((a, b) => b.remainder - a.remainder || a.vault.id.localeCompare(b.vault.id));
  for (const share of shares) {
    share.vault.weightBps = share.floor + (leftover > 0 ? 1 : 0);
    leftover -= leftover > 0 ? 1 : 0;
  }
}
