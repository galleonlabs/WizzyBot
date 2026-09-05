import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { harnesses, installArgs, installedVersion, parseCatalog, parseConfig, selectPacks, type Pack } from "../src/core";
import catalog from "../catalog/skills.json";

const primitives = ["lending", "staking", "yield", "tokenized-assets", "routing", "derivatives", "portfolio", "security", "payments", "governance"];
const newPack = (name: string): Pack => ({
  id: `defi-${name}-skills`, source: "galleonlabs/crypto-defi-skills", path: `packages/${name}`,
  package: `galleon-defi-${name}-skills`, version: "0.1.0", revision: "a".repeat(40),
  skills: [`galleon-defi-${name}`], description: `Fixture ${name} workflow.`,
});

test("new DeFi primitives retain the explicit package, directory and skill namespace boundary", () => {
  const expanded = parseCatalog({ schemaVersion: 3, packs: primitives.map(newPack) });
  expect(expanded.packs.map(pack => pack.path)).toContain("packages/tokenized-assets");
  const security = newPack("security");
  for (const patch of [
    { id: "defi-security" }, { package: "galleon-security-skills" }, { path: "packages/defi-security" },
    { path: "packages/security/../portfolio" }, { skills: ["galleon-defi-portfolio"] },
    { skills: ["defi-security"] }, { skills: ["galleon-defi-securityevil"] }, { source: "third-party/security" },
  ]) expect(() => parseCatalog({ schemaVersion: 3, packs: [{ ...security, ...patch }] })).toThrow();
  expect(() => parseCatalog({ schemaVersion: 3, packs: [security, { ...security, id: "security-skills", package: "galleon-security-skills", skills: ["security-review"] }] })).toThrow();
});

test("catalog growth changes fresh defaults but never expands saved or independent selections", () => {
  const prior = parseCatalog(catalog).packs.filter(pack => ["lp-skills", "hyperliquid-skills", "defi-infra-skills", "defi-data-skills"].includes(pack.id));
  const expanded = parseCatalog({ schemaVersion: 3, packs: [...prior, ...primitives.map(newPack)] });
  const config = parseConfig({ schemaVersion: 1, harness: "hermes", directory: "/tmp/boomkin-selection", packs: prior.map(pack => pack.id) }, "/tmp/boomkin-selection");
  expect(selectPacks(expanded, config.packs).packs.map(pack => pack.id)).toEqual(prior.map(pack => pack.id));
  expect(selectPacks(expanded).packs.map(pack => pack.id)).toEqual([...prior.map(pack => pack.id), ...primitives.map(name => `defi-${name}-skills`)]);
  expect(selectPacks(expanded, ["defi-security-skills"]).packs.flatMap(pack => pack.skills)).toEqual(["galleon-defi-security"]);
});

test("six upstream harness installers discover an independently selected new skill from local source", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "boomkin-primitives-")));
  const source = join(root, "source");
  const home = join(root, "home");
  const bin = resolve(import.meta.dirname, "../node_modules/skills/bin/cli.mjs");
  try {
    await mkdir(home);
    for (const name of ["galleon-defi-security", "galleon-defi-portfolio"]) {
      const directory = join(source, "skills", name);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: Use when reviewing a synthetic fixture.\nmetadata:\n  version: "0.1.0"\n---\nRead the synthetic proposal without executing it.\n`);
      await writeFile(join(directory, "LICENSE"), "Synthetic fixture notice.\n");
    }
    for (const [name, adapter] of Object.entries(harnesses)) {
      const directory = join(root, name);
      await mkdir(directory);
      const child = Bun.spawn([process.execPath, bin, ...installArgs(source, name as keyof typeof harnesses, ["galleon-defi-security"])], {
        cwd: directory,
        env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), CODEX_HOME: join(home, ".codex"), XDG_STATE_HOME: join(directory, ".state"), HERMES_HOME: directory, DISABLE_TELEMETRY: "1" },
        stdout: "pipe", stderr: "pipe", timeout: 30_000,
      });
      const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (code !== 0) throw new Error(`${name} fixture installation failed: ${output}\n${errors}`);
      const skills = join(directory, adapter.skillsPath);
      expect(await readdir(skills)).toEqual(["galleon-defi-security"]);
      expect(installedVersion(await readFile(join(skills, "galleon-defi-security/SKILL.md"), "utf8"))).toBe("0.1.0");
      expect(await readFile(join(skills, "galleon-defi-security/LICENSE"), "utf8")).toBe("Synthetic fixture notice.\n");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);

test("onboarding preserves a saved selection unless all-packs is explicitly requested", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "boomkin-onboard-selection-")));
  try {
    await mkdir(join(directory, ".boomkin"));
    const saved = JSON.stringify({ schemaVersion: 1, harness: "hermes", directory, packs: ["defi-data-skills"] });
    await writeFile(join(directory, ".boomkin/config.json"), saved);
    for (const all of [false, true]) {
      const child = Bun.spawn([process.execPath, "src/cli.ts", "onboard", "--directory", directory, "--dry-run", ...(all ? ["--all-packs"] : [])], { stdout: "pipe", stderr: "pipe" });
      const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (code !== 0) throw new Error(errors);
      const installs = output.split("\n").filter(line => line.startsWith("Install galleonlabs/"));
      expect(installs).toHaveLength(all ? catalog.packs.length : 1);
      if (!all) expect(installs[0]).toContain("/packages/data@");
      expect(await readFile(join(directory, ".boomkin/config.json"), "utf8")).toBe(saved);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
