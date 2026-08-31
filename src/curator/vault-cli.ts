#!/usr/bin/env bun
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseStableCatalog } from "../vaults/catalog.js";
import { planStableCatalogUpdate } from "./vault-catalog-update.js";
import { runVaultCurator } from "./vault-run.js";

function argument(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const stateDir = argument("--state-dir")
  ?? process.env.UNABOT_CURATOR_STATE_DIR
  ?? join(process.env.HOME ?? "", ".local/state/unabot-curator");
const persist = !process.argv.includes("--no-write");
const apply = process.argv.includes("--apply");

const report = await runVaultCurator({ stateDir, persist });
if (!apply) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

const catalogPath = "src/config/stable-vaults.json";
const { readFile } = await import("node:fs/promises");
const catalog = parseStableCatalog(JSON.parse((await readFile(catalogPath)).toString("utf8")));
const update = planStableCatalogUpdate({ report, catalog, today: new Date().toISOString().slice(0, 10) });
if (update.changed) {
  const pending = `${catalogPath}.${process.pid}.tmp`;
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await writeFile(pending, `${JSON.stringify(update.catalog, null, 2)}\n`, { mode: 0o644 });
  await rename(pending, catalogPath);
}
process.stdout.write(`${JSON.stringify({ generatedAt: report.generatedAt, appliedPauses: update.appliedPauses, changed: update.changed })}\n`);
