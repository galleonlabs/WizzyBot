import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, cp, symlink } from "node:fs/promises";
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
