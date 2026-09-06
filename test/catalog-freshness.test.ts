import { expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";
import { readFile } from "node:fs/promises";
import { parseCatalog } from "../src/core";
import { compareVersions, evaluateCatalog, listUpstreamTags, parseTagListing, reportCatalog, type ReleaseTag } from "../src/catalog-freshness";
import catalogFile from "../catalog/skills.json";

const catalog = parseCatalog(catalogFile);
const matching: ReleaseTag[] = catalog.packs.map(pack => ({ package: pack.package, version: pack.version, revision: pack.revision }));

test("tag listing parses lightweight and peeled annotated tags", () => {
  const listing = [
    "7e3224c0aacd70624f99e34381d9b2a5d8d60cbb\trefs/tags/galleon-lp-skills@0.5.0",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/galleon-defi-infra-skills@0.2.1",
    "38e58b1c9c345af0f3a61ce1d25fe33095c2003b\trefs/tags/galleon-defi-infra-skills@0.2.1^{}",
  ].join("\n");
  expect(parseTagListing(listing)).toEqual([
    { package: "galleon-lp-skills", version: "0.5.0", revision: "7e3224c0aacd70624f99e34381d9b2a5d8d60cbb" },
    { package: "galleon-defi-infra-skills", version: "0.2.1", revision: "38e58b1c9c345af0f3a61ce1d25fe33095c2003b" },
  ]);
});

test("empty or unparseable tag output fails closed instead of reporting all-clear", () => {
  for (const output of ["", "not a tag listing", "deadbeef\trefs/tags/galleon-lp-skills@0.5.0", "7e3224c0aacd70624f99e34381d9b2a5d8d60cbb refs/tags/galleon-lp-skills@0.5.0"]) {
    expect(() => parseTagListing(output)).toThrow("Unable to parse upstream release tags");
  }
});

test("conflicting unpeeled SHAs for the same tag fail closed", () => {
  const listing = [
    "7e3224c0aacd70624f99e34381d9b2a5d8d60cbb\trefs/tags/galleon-lp-skills@0.5.0",
    "38e58b1c9c345af0f3a61ce1d25fe33095c2003b\trefs/tags/galleon-lp-skills@0.5.0",
  ].join("\n");
  expect(() => parseTagListing(listing)).toThrow("Unable to parse upstream release tags");
});

test("network failure listing tags is distinguishable from drift", async () => {
  await expect(listUpstreamTags(async () => { throw new Error("Could not resolve host"); })).rejects.toThrow("Unable to list upstream release tags");
});

test("exact matching tags report current and pass verify", () => {
  const reports = evaluateCatalog(catalog, matching);
  expect(reports).toHaveLength(catalog.packs.length);
  expect(reports.every(report => report.authenticity === "ok" && report.freshness === "current")).toBe(true);
  expect(reportCatalog(catalog, matching, "verify").exitCode).toBe(0);
  expect(reportCatalog(catalog, matching, "freshness").exitCode).toBe(0);
  expect(reportCatalog(catalog, matching, "verify").text).toContain("matches published upstream release tags");
});

test("a newer upstream release is advisory in freshness and ignored by verify", () => {
  const pinned = catalog.packs.find(pack => pack.id === "defi-infra-skills")!;
  const [major, minor, patch] = pinned.version.split(".").map(Number);
  const nextVersion = `${major}.${minor}.${patch! + 1}`;
  const newer = [...matching, { package: pinned.package, version: nextVersion, revision: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }];
  const reports = evaluateCatalog(catalog, newer);
  const infra = reports.find(report => report.id === "defi-infra-skills")!;
  expect(infra.authenticity).toBe("ok");
  expect(infra.freshness).toBe("behind");
  expect(infra.latestVersion).toBe(nextVersion);
  expect(reportCatalog(catalog, newer, "verify").exitCode).toBe(0);
  const freshness = reportCatalog(catalog, newer, "freshness");
  expect(freshness.exitCode).toBe(1);
  expect(freshness.failures[0]).toContain("galleon-defi-infra-skills is behind");
  expect(freshness.failures[0]).toContain(pinned.version);
  expect(freshness.failures[0]).toContain(nextVersion);
});

test("a missing release tag fails verify", () => {
  const pack = catalog.packs[0]!;
  const missing = matching.filter(tag => tag.package !== pack.package);
  const result = reportCatalog(catalog, missing, "verify");
  expect(result.exitCode).toBe(1);
  expect(result.failures[0]).toContain(`${pack.package}@${pack.version} has no matching upstream release tag`);
  expect(reportCatalog(catalog, missing, "freshness").exitCode).toBe(1);
});

test("a tag/revision mismatch fails verify", () => {
  const mismatch = matching.map(tag => tag.package === "galleon-lp-skills" ? { ...tag, revision: "cccccccccccccccccccccccccccccccccccccccc" } : tag);
  const result = reportCatalog(catalog, mismatch, "verify");
  expect(result.exitCode).toBe(1);
  expect(result.failures[0]).toContain("does not match upstream tag");
  expect(evaluateCatalog(catalog, mismatch).find(report => report.id === "lp-skills")?.authenticity).toBe("revision-mismatch");
});

test("version comparison orders patch releases", () => {
  expect(compareVersions("0.2.1", "0.2.2")).toBeLessThan(0);
  expect(compareVersions("0.3.1", "0.3.0")).toBeGreaterThan(0);
  expect(compareVersions("0.5.0", "0.5.0")).toBe(0);
});

test("catalog freshness verify runs on pull requests that touch catalog pins", async () => {
  const text = await readFile(new URL("../.github/workflows/catalog-freshness.yml", import.meta.url), "utf8");
  const workflow = parseYaml(text) as {
    on: { pull_request?: { paths?: string[] }; schedule?: unknown; workflow_dispatch?: unknown };
    jobs: { verify?: { if?: string; steps?: { run?: string }[] }; report?: { if?: string; steps?: { run?: string }[] } };
  };
  expect(workflow.on.pull_request?.paths).toContain("catalog/**");
  expect(workflow.on.pull_request?.paths).toContain("scripts/catalog-freshness.ts");
  expect(workflow.on.schedule).toBeDefined();
  expect(workflow.on.workflow_dispatch).toBeDefined();
  expect(workflow.jobs.verify?.if).toContain("pull_request");
  expect(workflow.jobs.verify?.steps?.some(step => step.run === "bun scripts/catalog-freshness.ts --verify")).toBe(true);
  expect(workflow.jobs.report?.if).toContain("!= 'pull_request'");
  expect(workflow.jobs.report?.steps?.some(step => step.run === "bun scripts/catalog-freshness.ts")).toBe(true);
});
