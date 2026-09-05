import { access, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { parseConfig } from "./core.ts";

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

// The former name exists only at this migration boundary. Never merge two states.
export async function stateDirectory(directory: string, migrate: boolean): Promise<string> {
  const current = join(directory, ".boomkin");
  const legacy = join(directory, ".wizzy");
  const [hasCurrent, hasLegacy] = await Promise.all([exists(current), exists(legacy)]);
  if (!hasLegacy) return current;
  if (hasCurrent) throw new Error("Both .boomkin and legacy .wizzy state exist. Review and resolve them before continuing; no state was merged.");
  if (await exists(join(legacy, "operation.lock"))) throw new Error("Legacy installer operation is active or interrupted. Resolve its operation.lock before migration.");
  parseConfig(JSON.parse(await readFile(join(legacy, "config.json"), "utf8")), directory);
  if (!migrate) return legacy;
  await rename(legacy, current);
  return current;
}
