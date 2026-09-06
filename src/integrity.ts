import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { Catalog } from "./core.ts";

export type SkillIntegrity = Record<string, Record<string, string>>;
const digest = (content: Uint8Array) => createHash("sha256").update(content).digest("hex");

// Copies must keep every resource with the skill. No provider or model calls.
export async function skillFiles(directory: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function walk(path: string) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error("Installed skill contains a symbolic link; review it before updating.");
    if (stat.isDirectory()) {
      for (const entry of await readdir(path)) await walk(join(path, entry));
    } else if (stat.isFile()) files[relative(directory, path).replaceAll("\\", "/")] = digest(await readFile(path));
    else throw new Error("Installed skill contains an unsupported file type.");
  }
  await walk(directory);
  if (!files["SKILL.md"]) throw new Error("Installed skill is missing SKILL.md.");
  return files;
}

export async function verifyCopiedSkill(source: string, installed: string) {
  const expected = await skillFiles(source), actual = await skillFiles(installed);
  for (const [file, hash] of Object.entries(expected)) {
    // Eve normalizes frontmatter. The caller verifies its installed version.
    if (file !== "SKILL.md" && actual[file] !== hash) throw new Error(`Installed skill resource is missing or changed: ${file}. Sync not marked complete.`);
  }
  return actual;
}

export async function verifyIntegrity(skillsRoot: string, catalog: Catalog, value: unknown): Promise<string[]> {
  const issues: string[] = [];
  const object = (entry: unknown): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry);
  if (!object(value)) return ["Run update to record integrity for installed skills and references"];
  for (const skill of catalog.packs.flatMap(pack => pack.skills)) {
    const expected = value[skill];
    if (!object(expected) || typeof expected["SKILL.md"] !== "string" || !Object.keys(expected).length) {
      issues.push(`Run update to record integrity for ${skill}`);
      continue;
    }
    let actual: Record<string, string>;
    try { actual = await skillFiles(join(skillsRoot, skill)); }
    catch { issues.push(`Review missing or unsupported files in ${skill}, then run update`); continue; }
    // Stored paths are used only as keys, never as filesystem read targets.
    if (Object.entries(expected).some(([file, hash]) => typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash) || actual[file] !== hash) || Object.keys(actual).length !== Object.keys(expected).length) {
      issues.push(`Installed ${skill} files changed; preserve local edits before running update`);
    }
  }
  return issues;
}

export async function readIntegrity(directory: string): Promise<unknown> {
  try { return JSON.parse(await readFile(resolve(directory, ".boomkin/last-sync.json"), "utf8")).integrity; }
  catch { return undefined; }
}
