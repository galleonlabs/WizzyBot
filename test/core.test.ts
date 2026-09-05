import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCatalog, parseConfig, parseHarness, installArgs, harnesses } from "../src/core";
import catalog from "../catalog/skills.json";

describe("trust and installation boundaries", () => {
  test("catalog rejects external sources, options, duplicates, and schema drift", () => {
    expect(parseCatalog(catalog).packs).toHaveLength(2);
    for (const source of ["evil/lp-skills", "--global", "galleonlabs/lp-skills@evil"]) {
      expect(() => parseCatalog({ schemaVersion: 1, packs: [{ id: "lp-skills", source, description: "test" }] })).toThrow();
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
      const args = installArgs("galleonlabs/lp-skills", harness);
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
