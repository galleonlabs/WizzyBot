import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCatalog, parseConfig, parseHarness, installArgs, harnesses, fetchCatalog, catalogChanges, installedVersion, selectPacks } from "../src/core";
import catalog from "../catalog/skills.json";

describe("trust and installation boundaries", () => {
  test("catalog rejects external sources, options, duplicates, and schema drift", () => {
    expect(parseCatalog(catalog).packs).toHaveLength(2);
    for (const source of ["evil/lp-skills", "--global", "galleonlabs/crypto-defi-skills@evil"]) {
      expect(() => parseCatalog({ ...catalog, packs: [{ ...catalog.packs[0], source }] })).toThrow();
    }
    expect(() => parseCatalog({ ...catalog, packs: [catalog.packs[0], catalog.packs[0]] })).toThrow();
    expect(() => parseCatalog({ ...catalog, schemaVersion: 2 })).toThrow();
  });
  test("unrecognized harnesses and moved state fail closed", () => {
    for (const name of ["toString", "constructor", "unknown"]) expect(() => parseHarness(name)).toThrow();
    expect(() => parseConfig({ schemaVersion: 1, harness: "eve", directory: "/old" }, "/new")).toThrow();
  });
  test("Hermes targets its profile, other adapters stay project scoped", () => {
    for (const harness of Object.keys(harnesses) as (keyof typeof harnesses)[]) {
      const args = installArgs("/tmp/verified-skills", harness, ["lp-setup"]);
      expect(args.includes("--global")).toBe(harness === "hermes");
      expect(args).toContain("--copy");
      expect(args).toContain(harnesses[harness].agent);
    }
  });
  test("dry run does not create a workspace, config, or install files", async () => {
    const root = await mkdtemp(join(tmpdir(), "boomkin-test-"));
    const directory = join(root, "not-created");
    try {
      const p = Bun.spawn([process.execPath, "src/cli.ts", "setup", "--harness", "eve", "--directory", directory, "--dry-run"], { stdout: "pipe", stderr: "pipe" });
      expect(await p.exited).toBe(0);
      expect(await new Response(p.stdout).text()).toContain("galleonlabs/crypto-defi-skills/packages/hyperliquid");
      expect(await Bun.file(join(directory, ".boomkin/config.json")).exists()).toBe(false);
      await expect(readFile(directory)).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  test("unknown flags and missing directories do not start installation", async () => {
    for (const args of [["setup", "--harness", "eve"], ["setup", "--force"], ["oops"]]) {
      const p = Bun.spawn([process.execPath, "src/cli.ts", ...args], { stdout: "pipe", stderr: "pipe" });
      expect(await p.exited).toBe(1);
    }
  });
});


test("pins release versions and rejects branch names or missing version metadata", () => {
  const pack = parseCatalog(catalog).packs[0]!;
  expect(installArgs("/tmp/verified-skills", "eve", ["lp-setup"])[1]).toBe("/tmp/verified-skills");
  for (const revision of ["main", "v0.4.0", "../../evil", "shortsha"]) expect(() => parseCatalog({ schemaVersion: 3, packs: [{ ...pack, revision }] })).toThrow();
  expect(() => parseCatalog({ schemaVersion: 3, packs: [{ ...pack, version: undefined }] })).toThrow();
});
test("checks report new revisions, new packs, and retirement without installing", () => {
  const current = parseCatalog(catalog);
  expect(catalogChanges(current, current)).toEqual([]);
  expect(catalogChanges(current)).toHaveLength(2);
  expect(catalogChanges({ ...current, packs: [current.packs[0]!] }, current)[0]).toContain("retired");
});
test("catalog fetch fails closed on HTTP failure and invalid data", async () => {
  await expect(fetchCatalog((async () => new Response("down", { status: 503 })))).rejects.toThrow("503");
  await expect(fetchCatalog((async () => Response.json({ schemaVersion: 3, packs: [] })))).rejects.toThrow();
});


test("reads both original and Eve-normalized skill version metadata", () => {
  expect(installedVersion('---\nname: lp-setup\nmetadata:\n  version: "0.4.0"\n---\nbody')).toBe("0.4.0");
  expect(installedVersion('---\ndescription: "Setup"\nmetadata: {"version":"0.4.0"}\n---\nbody')).toBe("0.4.0");
  expect(installedVersion("No metadata")).toBeUndefined();
});
test("checks detect corrected release metadata even with the same revision", () => {
  const current = parseCatalog(catalog);
  const previous = structuredClone(current);
  previous.packs[0]!.version = "0.0.1";
  expect(catalogChanges(current, previous)).toHaveLength(1);
  previous.packs[0]!.version = current.packs[0]!.version;
  previous.packs[0]!.skills.pop();
  expect(catalogChanges(current, previous)).toHaveLength(1);
});

test("monorepo package paths and identities are explicit and cannot escape", () => {
  for (const path of ["../lp", "packages/../../evil", "packages/lp/../hyperliquid", "/tmp/lp", "packages/hyperliquid"]) {
    expect(() => parseCatalog({ ...catalog, packs: [{ ...catalog.packs[0], path }] })).toThrow();
  }
  expect(() => parseCatalog({ ...catalog, packs: [{ ...catalog.packs[0], package: "evil" }] })).toThrow();
});
test("pack selection installs only requested packages and rejects unknown names", () => {
  const current = parseCatalog(catalog);
  expect(selectPacks(current, ["lp-skills"]).packs.map(p => p.id)).toEqual(["lp-skills"]);
  expect(() => selectPacks(current, ["missing"])).toThrow();
  expect(() => selectPacks(current, ["lp-skills", "lp-skills"])).toThrow();
  const args = installArgs("/tmp/packages/lp", "eve", ["lp-setup", "lp-plan"]);
  expect(args).toContain("lp-setup");
  expect(args).not.toContain("*");
  expect(args).not.toContain("hyperliquid-setup");
});
test("saved selections validate and source path changes require an update", () => {
  expect(() => parseConfig({ schemaVersion: 1, harness: "eve", directory: "/tmp", packs: [] }, "/tmp")).toThrow();
  const current = parseCatalog(catalog);
  const previous = structuredClone(current);
  previous.packs[0]!.path = "packages/old";
  expect(catalogChanges(current, previous)).toHaveLength(1);
});

test("legacy configurations never opt into future catalog packs", () => {
  const config = parseConfig({ schemaVersion: 1, harness: "codex", directory: "/tmp/legacy" }, "/tmp/legacy");
  const current = parseCatalog(catalog);
  const future = parseCatalog({ ...catalog, packs: [...current.packs, {
    ...current.packs[0], id: "aave-skills", path: "packages/aave", package: "galleon-aave-skills", skills: ["aave-setup"],
  }] });
  expect(selectPacks(future, config.packs).packs.map(pack => pack.id)).toEqual(["lp-skills", "hyperliquid-skills"]);
  expect(selectPacks(future).packs).toHaveLength(3);
});
