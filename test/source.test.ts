import { expect, test } from "bun:test";
import { checkoutPack } from "../src/source";
import { parseCatalog } from "../src/core";
import catalog from "../catalog/skills.json";

test("a mismatched downloaded commit cannot reach installation", async () => {
  const pack = parseCatalog(catalog).packs[0]!;
  await expect(checkoutPack(pack, "/tmp/test-checkout", async args => args.includes("rev-parse") ? "wrong-commit" : "")).rejects.toThrow("mismatch");
});
test("source is resolved by commit, independent of release tag names", async () => {
  const pack = parseCatalog(catalog).packs[0]!;
  const commands: string[][] = [];
  await checkoutPack(pack, "/tmp/test-checkout", async args => { commands.push(args); return args.includes("rev-parse") ? pack.revision : ""; });
  expect(commands.find(args => args.includes("fetch"))?.at(-1)).toBe(pack.revision);
  expect(commands.some(args => args.includes(`v${pack.version}`))).toBe(false);
});

test("network failure stops source preparation", async () => {
  const pack = parseCatalog(catalog).packs[0]!;
  await expect(checkoutPack(pack, "/tmp/test-checkout", async args => {
    if (args.includes("fetch")) throw new Error("network unavailable");
    return "";
  })).rejects.toThrow("network unavailable");
});

test("selected package metadata, missing skills, and escaping links fail closed", async () => {
  const { mkdtemp, mkdir, writeFile, rm, symlink } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { packageDirectory } = await import("../src/source");
  const root = await mkdtemp(join(tmpdir(), "boomkin-source-"));
  const pack = parseCatalog(catalog).packs[0]!;
  const path = join(root, pack.path);
  try {
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "package.json"), JSON.stringify({ name: pack.package, version: "0.0.0" }));
    await expect(packageDirectory(pack, root)).rejects.toThrow("metadata mismatch");
    await writeFile(join(path, "package.json"), JSON.stringify({ name: pack.package, version: pack.version }));
    await expect(packageDirectory(pack, root)).rejects.toThrow();
    for (const skill of pack.skills) {
      await mkdir(join(path, "skills", skill), { recursive: true });
      await writeFile(join(path, "skills", skill, "SKILL.md"), `---\nname: ${skill}\nmetadata:\n  version: "${pack.version}"\n---\n`);
    }
    expect(await packageDirectory(pack, root)).toContain(pack.path);
    await symlink("/tmp", join(path, "escape"));
    await expect(packageDirectory(pack, root)).rejects.toThrow("symbolic link");
  } finally { await rm(root, { recursive: true, force: true }); }
});
