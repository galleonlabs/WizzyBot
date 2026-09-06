import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, cp, symlink, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { skillFiles, verifyCopiedSkill, verifyIntegrity } from "../src/integrity.ts";
import { parseCatalog, selectPacks } from "../src/core.ts";
import catalogFile from "../catalog/skills.json";

test("resources are checked before sync, and later edits or missing files are diagnosed", async () => {
  const root = await mkdtemp(join(tmpdir(), "boomkin-integrity-"));
  const catalog = selectPacks(parseCatalog(catalogFile), ["defi-data-skills"]);
  const skill = catalog.packs[0]!.skills[0]!;
  const source = join(root, "source"), installed = join(root, "skills", skill);
  try {
    await mkdir(join(source, "references"), { recursive: true });
    await writeFile(join(source, "SKILL.md"), "source metadata");
    await writeFile(join(source, "references/guide.md"), "required workflow");
    await cp(source, installed, { recursive: true });
    await writeFile(join(installed, "SKILL.md"), "Eve-normalized metadata");
    const integrity = { [skill]: await verifyCopiedSkill(source, installed) };
    expect(await verifyIntegrity(join(root, "skills"), catalog, integrity)).toEqual([]);
    await writeFile(join(installed, "references/guide.md"), "local change");
    expect((await verifyIntegrity(join(root, "skills"), catalog, integrity))[0]).toContain("preserve local edits");
    await expect(verifyCopiedSkill(source, installed)).rejects.toThrow("resource is missing or changed");
    await rm(join(installed, "references/guide.md"));
    expect(await verifyIntegrity(join(root, "skills"), catalog, integrity)).not.toEqual([]);
    await symlink(join(source, "references/guide.md"), join(installed, "references/guide.md"));
    await expect(skillFiles(installed)).rejects.toThrow("symbolic link");
    for (const record of [undefined, [], {}, { [skill]: { "../../private": "0".repeat(64) } }]) {
      expect(await verifyIntegrity(join(root, "skills"), catalog, record)).not.toEqual([]);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("check reports changed installed files whether or not a catalog update is pending", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "boomkin-check-")));
  const catalog = selectPacks(parseCatalog(catalogFile), ["defi-data-skills"]);
  const pack = catalog.packs[0]!, skill = pack.skills[0]!;
  const installed = join(directory, "skills", skill);
  const state = join(directory, ".boomkin");
  const reference = join(installed, "references/guide.md");
  const check = async () => {
    const child = Bun.spawn([process.execPath, "src/cli.ts", "check", "--directory", directory, "--offline-catalog"], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, stdout, stderr };
  };
  const record = async (recorded: typeof catalog) => {
    const integrity = { [skill]: await skillFiles(installed) };
    await writeFile(join(state, "last-sync.json"), JSON.stringify({ syncedAt: "recorded", catalog: recorded, integrity }));
  };
  try {
    await mkdir(join(installed, "references"), { recursive: true });
    await mkdir(state, { recursive: true });
    await writeFile(join(installed, "SKILL.md"), `---\nname: ${skill}\nmetadata:\n  version: "${pack.version}"\n---\n`);
    await writeFile(reference, "required workflow");
    await writeFile(join(state, "config.json"), JSON.stringify({ schemaVersion: 1, harness: "hermes", directory, packs: [pack.id] }));
    await record(catalog);

    const clean = await check();
    expect(clean.code).toBe(0);
    expect(clean.stdout).toContain("match the published Boomkin catalog");

    await writeFile(reference, "local change");
    const tampered = await check();
    expect(tampered.code).toBe(1);
    expect(tampered.stderr).toContain("preserve local edits");

    // A pending catalog change is informational; it must not suppress the integrity report.
    await writeFile(reference, "required workflow");
    const behind = { ...catalog, packs: [{ ...pack, version: "0.0.1" }] };
    await record(behind);
    const pending = await check();
    expect(pending.code).toBe(0);
    expect(pending.stdout).toContain(`0.0.1 -> ${pack.version}`);

    await writeFile(reference, "local change");
    const both = await check();
    expect(both.code).toBe(1);
    expect(both.stdout).toContain(`0.0.1 -> ${pack.version}`);
    expect(both.stderr).toContain("preserve local edits");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
