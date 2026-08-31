import { describe, expect, it } from "vitest";
import { planStableCatalogUpdate } from "../src/curator/vault-catalog-update.js";
import { evaluateVault, type VaultObservation, type VaultReport } from "../src/curator/vault-run.js";
import { getStableCatalog, parseStableCatalog } from "../src/vaults/catalog.js";

const VAULT = { id: "v-test", name: "Test Vault", curatorName: "Curator", status: "active" };

function observation(overrides: Partial<VaultObservation> = {}): VaultObservation {
  return {
    at: new Date().toISOString(),
    vaultId: "v-test",
    totalAssetsUsd: 200_000_000,
    netApy: 0.04,
    timelockSeconds: 168 * 3600,
    ...overrides,
  };
}

function report(recommendation: "hold" | "review" | "pause", vaultId: string): VaultReport {
  return {
    version: 1,
    role: "vault-curator",
    generatedAt: new Date().toISOString(),
    catalogVersion: getStableCatalog().version,
    evaluations: [{
      vaultId,
      name: "x",
      curatorName: "y",
      incumbent: true,
      recommendation,
      reasons: ["test"],
      summary: {
        observations: 1,
        latestTotalAssetsUsd: 1,
        medianTotalAssetsUsd: 1,
        totalAssetsDrop24hPct: null,
        medianNetApyPct: 4,
        latestTimelockHours: 168,
      },
    }],
  };
}

describe("vault policy gates", () => {
  it("holds a healthy vault", () => {
    const row = evaluateVault(VAULT, [observation()]);
    expect(row.recommendation).toBe("hold");
    expect(row.reasons).toEqual(["all vault gates pass"]);
  });

  it("reviews below the TVL floor and pauses on collapse", () => {
    expect(evaluateVault(VAULT, [observation({ totalAssetsUsd: 40_000_000 })]).recommendation).toBe("review");
    expect(evaluateVault(VAULT, [observation({ totalAssetsUsd: 10_000_000 })]).recommendation).toBe("pause");
  });

  it("pauses when the timelock disappears", () => {
    const row = evaluateVault(VAULT, [observation({ timelockSeconds: 3600 })]);
    expect(row.recommendation).toBe("pause");
    expect(row.reasons.join(" ")).toMatch(/timelock/);
  });

  it("pauses on a 24h TVL collapse and reviews on a smaller fall", () => {
    const dayAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    const collapse = evaluateVault(VAULT, [
      observation({ at: dayAgo, totalAssetsUsd: 300_000_000 }),
      observation({ totalAssetsUsd: 120_000_000 }),
    ]);
    expect(collapse.recommendation).toBe("pause");
    const dip = evaluateVault(VAULT, [
      observation({ at: dayAgo, totalAssetsUsd: 300_000_000 }),
      observation({ totalAssetsUsd: 195_000_000 }),
    ]);
    expect(dip.recommendation).toBe("review");
  });

  it("reports missing provider data without failing a gate", () => {
    const row = evaluateVault(VAULT, [observation({ totalAssetsUsd: null, netApy: null, timelockSeconds: null })]);
    expect(row.recommendation).toBe("hold");
    expect(row.reasons.join(" ")).toMatch(/unavailable/);
  });
});

describe("stable catalog update", () => {
  it("applies a pause with proportional redistribution", () => {
    const catalog = getStableCatalog();
    const target = catalog.vaults.filter((vault) => vault.status === "active")
      .sort((a, b) => a.weightBps - b.weightBps)[0]!;
    const update = planStableCatalogUpdate({ report: report("pause", target.id), catalog, today: "2026-09-01" });
    expect(update.changed).toBe(true);
    expect(update.appliedPauses).toEqual([`${target.id}:test`]);
    const parsed = parseStableCatalog(update.catalog);
    expect(parsed.vaults.find((vault) => vault.id === target.id)!.status).toBe("paused");
    expect(parsed.vaults.filter((vault) => vault.status === "active").reduce((sum, vault) => sum + vault.weightBps, 0)).toBe(10_000);
    expect(update.catalog.version).toBe(catalog.version + 1);
  });

  it("makes no change for hold and review calls", () => {
    const catalog = getStableCatalog();
    const active = catalog.vaults.find((vault) => vault.status === "active")!;
    for (const call of ["hold", "review"] as const) {
      const update = planStableCatalogUpdate({ report: report(call, active.id), catalog, today: "2026-09-01" });
      expect(update.changed).toBe(false);
    }
  });

  it("refuses stale or mismatched reports", () => {
    const catalog = getStableCatalog();
    const active = catalog.vaults.find((vault) => vault.status === "active")!;
    const stale = { ...report("pause", active.id), generatedAt: new Date(Date.now() - 24 * 3600_000).toISOString() };
    expect(() => planStableCatalogUpdate({ report: stale, catalog, today: "2026-09-01" })).toThrow(/stale/);
    const mismatched = { ...report("pause", active.id), catalogVersion: catalog.version + 5 };
    expect(() => planStableCatalogUpdate({ report: mismatched, catalog, today: "2026-09-01" })).toThrow(/does not match/);
  });
});
