#!/usr/bin/env bun
import { mkdir, readFile, writeFile, rename, rm, realpath } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import catalogFile from "../catalog/skills.json";
import { harnesses, parseCatalog, parseHarness, parseConfig, installArgs, identity, type Config } from "./core.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const help = `WizzyBot — your harness, Galleon skills.

bun run wizzy harnesses
bun run wizzy catalog
bun run wizzy setup --harness hermes --directory ~/wizzy
bun run wizzy check --directory ~/wizzy
bun run wizzy update --directory ~/wizzy
bun run wizzy status --directory ~/wizzy

setup prints the upstream runtime setup guide and installs skills.
Install/sign into the harness separately with its native setup flow.
update refreshes the public catalog and reinstalls every current pack from upstream.
--offline-catalog uses the catalog bundled with this checkout.
--dry-run prints installation commands without writing files or installing skills.
No wallet, signer, hosted runtime, or background service is installed.`;

async function canonicalPath(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return join(await canonicalPath(dirname(path)), basename(path));
  }
}

async function main() {
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, strict: true, options: {
    harness: { type: "string" }, directory: { type: "string" }, "dry-run": { type: "boolean" }, "offline-catalog": { type: "boolean" }, help: { type: "boolean", short: "h" },
  } });
  const command = positionals[0] ?? "help";
  if (values.help || command === "help") return console.log(help);
  if (positionals.length > 1) throw new Error("Unexpected positional arguments");
  if (command === "harnesses") {
    for (const [name, h] of Object.entries(harnesses)) console.log(`${name}\n  ${h.setup}\n  ${h.docs}\n`);
    return;
  }
  if (command === "catalog") return console.log(JSON.stringify(parseCatalog(catalogFile), null, 2));
  if (!["setup", "update", "check", "status"].includes(command)) throw new Error(`Unknown command: ${command}`);
  if (!values.directory) throw new Error("Pass --directory with your harness workspace (Hermes: its HERMES_HOME).");
  const directory = await canonicalPath(resolve(values.directory));
  const stateDir = join(directory, ".wizzy");
  const configPath = join(stateDir, "config.json");
  let config: Config;
  if (command === "setup") config = { schemaVersion: 1, harness: parseHarness(values.harness), directory };
  else config = parseConfig(JSON.parse(await readFile(configPath, "utf8")), directory);
  const adapter = harnesses[config.harness];
  const env = { ...process.env, DISABLE_TELEMETRY: "1", XDG_STATE_HOME: join(stateDir, "state"), ...(config.harness === "hermes" ? { HERMES_HOME: directory } : {}) };
  const skillsBin = join(root, "node_modules/skills/bin/cli.mjs");
  async function run(args: string[]) {
    const child = Bun.spawn([process.execPath, skillsBin, ...args], { cwd: directory, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    if (await child.exited !== 0) throw new Error("Upstream skills command failed. Completed packs remain installed; rerun after resolving the error.");
  }
  if (command === "status") {
    console.log(JSON.stringify(config, null, 2));
    console.log(`Skills: ${join(directory, adapter.skillsPath)}\n${adapter.setup}`);
    return run(["list", "--agent", adapter.agent, ...(adapter.global ? ["--global"] : [])]);
  }
  if (command === "check") return run(["check"]);
  let catalog = parseCatalog(catalogFile);
  if (command === "update" && !values["offline-catalog"]) {
    const response = await fetch("https://raw.githubusercontent.com/galleonlabs/WizzyBot/main/catalog/skills.json", { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Catalog fetch failed (${response.status}); installed skills were not changed.`);
    catalog = parseCatalog(await response.json());
  }
  console.log(adapter.setup);
  for (const pack of catalog.packs) console.log(`skills ${installArgs(pack.source, config.harness).join(" ")}`);
  if (values["dry-run"]) return;
  await mkdir(directory, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  const lock = join(stateDir, "operation.lock");
  try { await mkdir(lock); } catch { throw new Error(`Another operation is active. If it crashed, remove ${lock} after checking no installer is running.`); }
  try {
    try {
      const existing = parseConfig(JSON.parse(await readFile(configPath, "utf8")), directory);
      if (existing.harness !== config.harness) throw new Error("This directory belongs to another harness. Use a separate workspace.");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    // Keep enough state to retry safely if one of the independent upstream installs fails.
    await writeFile(`${configPath}.tmp`, JSON.stringify(config, null, 2) + "\n");
    await rename(`${configPath}.tmp`, configPath);
    for (const pack of catalog.packs) await run(installArgs(pack.source, config.harness));
    const identityPath = join(directory, config.harness === "eve" ? "agent/instructions.md" : "AGENTS.md");
    await mkdir(dirname(identityPath), { recursive: true });
    try { await writeFile(identityPath, identity, { flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; console.log(`Preserved ${identityPath}. Add the Wizzy identity from docs/IDENTITY.md if wanted.`); }
    await writeFile(join(stateDir, "last-sync.json"), JSON.stringify({ syncedAt: new Date().toISOString(), catalog }, null, 2) + "\n");
    console.log(`Skills ready in ${join(directory, adapter.skillsPath)}. Restart the harness to reload.\n${adapter.setup}`);
  } finally { await rm(lock, { recursive: true }); }
}
main().catch(error => { console.error(`Wizzy: ${error.message}`); process.exitCode = 1; });
