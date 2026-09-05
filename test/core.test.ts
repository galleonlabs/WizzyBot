import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCatalog, parseConfig, parseHarness, installArgs, harnesses, fetchCatalog, catalogChanges, installedVersion } from "../src/core";
import catalog from "../catalog/skills.json";

describe("trust and installation boundaries", () => {
  test("catalog rejects external sources, options, duplicates, and schema drift", () => {
    expect(parseCatalog(catalog).packs).toHaveLength(2);
    for (const source of ["evil/lp-skills", "--global", "galleonlabs/lp-skills@evil"]) {
      expect(() => parseCatalog({ ...catalog, packs: [{ ...catalog.packs[0], source }] })).toThrow();
    }
    expect(() => parseCatalog({ ...catalog, packs: [catalog.packs[0], catalog.packs[0]] })).toThrow();
    expect(() => parseCatalog({ ...catalog, schemaVersion: 3 })).toThrow();
  });
  test("unrecognized harnesses and moved state fail closed", () => {
    for (const name of ["toString", "constructor", "unknown"]) expect(() => parseHarness(name)).toThrow();
    expect(() => parseConfig({ schemaVersion: 1, harness: "eve", directory: "/old" }, "/new")).toThrow();
  });
  test("Hermes targets its profile, other adapters stay project scoped", () => {
    for (const harness of Object.keys(harnesses) as (keyof typeof harnesses)[]) {
      const args = installArgs("/tmp/verified-skills", harness);
      expect(args.includes("--global")).toBe(harness === "hermes");
      expect(args).toContain("--copy");
      expect(args).toContain(harnesses[harness].agent);
    }
  });
  test("dry run does not create a workspace, config, or install files", async () => {
    const root = await mkdtemp(join(tmpdir(), "wizzy-test-"));
    const directory = join(root, "not-created");
    try {
      const p = Bun.spawn([process.execPath, "src/cli.ts", "setup", "--harness", "eve", "--directory", directory, "--dry-run"], { stdout: "pipe", stderr: "pipe" });
      expect(await p.exited).toBe(0);
      expect(await new Response(p.stdout).text()).toContain("galleonlabs/hyperliquid-skills");
      expect(await Bun.file(join(directory, ".wizzy/config.json")).exists()).toBe(false);
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
  expect(installArgs("/tmp/verified-skills", "eve")[1]).toBe("/tmp/verified-skills");
  for (const revision of ["main", "v0.4.0", "../../evil", "shortsha"]) expect(() => parseCatalog({ schemaVersion: 2, packs: [{ ...pack, revision }] })).toThrow();
  expect(() => parseCatalog({ schemaVersion: 2, packs: [{ ...pack, version: undefined }] })).toThrow();
});
test("checks report new revisions, new packs, and retirement without installing", () => {
  const current = parseCatalog(catalog);
  expect(catalogChanges(current, current)).toEqual([]);
  expect(catalogChanges(current)).toHaveLength(2);
  expect(catalogChanges({ ...current, packs: [current.packs[0]!] }, current)[0]).toContain("retired");
});
test("catalog fetch fails closed on HTTP failure and invalid data", async () => {
  await expect(fetchCatalog((async () => new Response("down", { status: 503 })))).rejects.toThrow("503");
  await expect(fetchCatalog((async () => Response.json({ schemaVersion: 2, packs: [] })))).rejects.toThrow();
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
