#!/usr/bin/env bun
import { mkdir, readFile, writeFile, rename, rm, realpath, mkdtemp } from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import catalogFile from "../catalog/skills.json";
import { harnesses, parseCatalog, parseHarness, parseConfig, installArgs, identity, fetchCatalog, catalogChanges, installedVersion, selectPacks, compatibilitySetupMessage, type Catalog, type Config } from "./core.ts";

import { tmpdir } from "node:os";
import { checkoutPack, packageDirectory } from "./source.ts";
import { defaultProfile, prepareHermes, connectProvider, providers, doctor } from "./onboarding.ts";
import { runHermes } from "./hermes.ts";
import { verifyCopiedSkill, verifyIntegrity, readIntegrity, type SkillIntegrity } from "./integrity.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const help = `Boomkin — your Hermes DeFi agent.

bun run boomkin onboard
bun run boomkin doctor --live
bun run boomkin start
bun run boomkin providers
bun run boomkin connect --provider alchemy
bun run boomkin connect --provider tenderly
bun run boomkin model
bun run boomkin check --directory ~/.boomkin/hermes
bun run boomkin update --directory ~/.boomkin/hermes

onboard installs the official Hermes runtime if needed, prepares an isolated profile,
installs the selected Galleon skill packs and public CoinGecko MCP, then runs native model setup.
--directory chooses the Hermes home (default ~/.boomkin/hermes for the commands above).
--skip-model-setup prepares files without an interactive model login.
--no-install uses an existing Hermes executable. --dry-run previews without writes.
--all-packs opts an existing onboarding profile into every pack in the current catalog.
doctor distinguishes configuration from verified reads; --live probes public MCP only.
connect uses native Hermes OAuth, AIXBT environment-backed authentication, or the official local Coinbase MCP.
Wallet/account setup stays in its official CLI; see docs/CONNECTIONS.md.

Advanced skill-only compatibility:
bun run boomkin setup --harness codex --directory ./agent --pack lp-skills
bun run boomkin harnesses
bun run boomkin catalog
--pack selects a pack (repeat for several); updates preserve your saved selection.
--offline-catalog uses this checkout's catalog. Runtime updates use native Hermes.
No model call, wallet funding, trading, paid data request or service starts in onboarding.`;

async function canonicalPath(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return join(await canonicalPath(dirname(path)), basename(path));
  }
}

async function main() {
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, strict: true, options: {
    "key-file": { type: "string" }, provider: { type: "string" }, live: { type: "boolean" }, "all-packs": { type: "boolean" }, "skip-model-setup": { type: "boolean" }, "no-install": { type: "boolean" }, pack: { type: "string", multiple: true }, harness: { type: "string" }, directory: { type: "string" }, "dry-run": { type: "boolean" }, "offline-catalog": { type: "boolean" }, help: { type: "boolean", short: "h" },
  } });
  const command = positionals[0] ?? "help";
  if (values.help || command === "help") return console.log(help);
  if (positionals.length > 1) throw new Error("Unexpected positional arguments");
  if (values["key-file"] && (command !== "connect" || values.provider !== "coinbase")) throw new Error("--key-file is only available for connect --provider coinbase");
  if (values.provider && command !== "connect") throw new Error("--provider is only available for connect");
  if (values.live && command !== "doctor") throw new Error("--live is only available for doctor");
  if ((values["all-packs"] || values["skip-model-setup"] || values["no-install"]) && command !== "onboard") throw new Error("Onboarding options are only available for onboard");
  if (values["dry-run"] && !["onboard", "setup", "update", "connect", "start", "model"].includes(command)) throw new Error("--dry-run is unavailable for this read-only command");

  if (command === "providers") {
    for (const [name, provider] of Object.entries(providers)) console.log(`${name}: ${provider.access}`);
    console.log("coinbase: official local MCP with a scoped account CLI environment and read tools. Agentic Wallet is separate; see docs/CONNECTIONS.md.");
    return;
  }
  if (["onboard", "doctor", "start", "connect", "model"].includes(command)) {
    if (values.harness && values.harness !== "hermes") throw new Error("Boomkin onboarding uses Hermes. Use setup for skill-only compatibility with another harness.");
    const directory = await canonicalPath(resolve(values.directory ?? defaultProfile()));
    if (command === "onboard") {
      if (values.pack && values["all-packs"]) throw new Error("Choose --pack or --all-packs, not both");
      const selected = values["all-packs"] ? parseCatalog(catalogFile).packs.map(pack => pack.id) : values.pack;
      const args = [process.execPath, fileURLToPath(import.meta.url), "setup", "--harness", "hermes", "--directory", directory,
        ...(selected?.flatMap(id => ["--pack", id]) ?? []), ...(values["dry-run"] ? ["--dry-run"] : [])];
      const child = Bun.spawn(args, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
      if (await child.exited !== 0) throw new Error("Skill setup did not finish. Resolve its reported issue and rerun onboard.");
      console.log(`Hermes home: ${directory}. Native model setup and keyless CoinGecko data; other providers are opt-in.`);
      await prepareHermes(directory, { install: !values["no-install"], dryRun: values["dry-run"], skipModelSetup: values["skip-model-setup"] });
      if (values["dry-run"]) return;
      console.log(JSON.stringify(await doctor(directory, parseCatalog(catalogFile)), null, 2));
      console.log("Onboarding saved. Use doctor --live to check public data, then start to launch Hermes. Complete any listed setup gaps first.");
      return;
    }
    if (values.pack || values["all-packs"] || values["skip-model-setup"] || values["no-install"]) throw new Error("Pack and installer options are only available for onboard here");
    if (command === "doctor") return console.log(JSON.stringify(await doctor(directory, parseCatalog(catalogFile), values.live), null, 2));
    if (command === "connect") return connectProvider(directory, values.provider ?? "", values["dry-run"], values["key-file"] ? resolve(values["key-file"]) : undefined);
    if (values["dry-run"]) return console.log(`Hermes ${command === "model" ? "setup model" : "chat"} in ${directory}`);
    return runHermes(directory, command === "model" ? ["setup", "model"] : ["chat"]);
  }

  if (command === "harnesses") {
    for (const [name, h] of Object.entries(harnesses)) console.log(`${name}\n  ${h.setup}\n  ${h.docs}\n`);
    return;
  }
  if (command === "catalog") return console.log(JSON.stringify(parseCatalog(catalogFile), null, 2));
  if (!["setup", "update", "check", "status"].includes(command)) throw new Error(`Unknown command: ${command}`);
  if (!values.directory) throw new Error("Pass --directory with your harness workspace (Hermes: its HERMES_HOME).");
  const directory = await canonicalPath(resolve(values.directory));
  const stateDir = join(directory, ".boomkin");
  const configPath = join(stateDir, "config.json");
  let config: Config;
  if (command === "setup") {
    config = { schemaVersion: 1, harness: parseHarness(values.harness), directory };
    try {
      const existing = parseConfig(JSON.parse(await readFile(configPath, "utf8")), directory);
      if (existing.harness !== config.harness) throw new Error("This directory belongs to another harness. Use a separate workspace.");
      config = existing;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  else config = parseConfig(JSON.parse(await readFile(configPath, "utf8")), directory);
  if (values.pack && !["setup", "update"].includes(command)) throw new Error("--pack is available for setup and update");
  if (values.pack) config.packs = values.pack;
  const adapter = harnesses[config.harness];
  const env = { ...process.env, DISABLE_TELEMETRY: "1", XDG_STATE_HOME: join(stateDir, "state"), ...(config.harness === "hermes" ? { HERMES_HOME: directory } : {}) };
  const skillsBin = join(root, "node_modules/skills/bin/cli.mjs");
  async function run(args: string[]) {
    const child = Bun.spawn([process.execPath, skillsBin, ...args], { cwd: directory, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    if (await child.exited !== 0) throw new Error("Upstream skills command failed. Completed packs remain installed; rerun after resolving the error.");
  }
  async function verifyInstalled(catalog: Catalog) {
    for (const pack of catalog.packs) {
      for (const skill of pack.skills) {
        const text = await readFile(join(directory, adapter.skillsPath, skill, "SKILL.md"), "utf8");
        const version = installedVersion(text);
        if (version !== pack.version) throw new Error(`Installed ${skill} has version ${version ?? "unknown"}; expected ${pack.version}. Sync not marked complete.`);
      }
    }
  }
  if (command === "status") {
    console.log(JSON.stringify(config, null, 2));
    console.log(`Skills: ${join(directory, adapter.skillsPath)}\n${adapter.setup}`);
    return run(["list", "--agent", adapter.agent, ...(adapter.global ? ["--global"] : [])]);
  }
  let previous: Catalog | undefined;
  try {
    const record = JSON.parse(await readFile(join(stateDir, "last-sync.json"), "utf8"));
    if (record.catalog?.schemaVersion === 3) previous = parseCatalog(record.catalog);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && command === "check") throw new Error("Sync record is incomplete; run update to rebuild it.");
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.log("Rebuilding an incomplete sync record.");
  }
  if (command === "check") {
    const current = selectPacks(await fetchCatalog(), config.packs);
    const changes = catalogChanges(current, previous);
    if (!changes.length && previous) {
      await verifyInstalled(current);
      const issues = await verifyIntegrity(join(directory, adapter.skillsPath), current, await readIntegrity(directory));
      if (issues.length) throw new Error(issues.join("; "));
    }
    return console.log(changes.length ? changes.join("\n") : "Recorded releases and installed skill files match the published Boomkin catalog.");
  }
  let catalog = parseCatalog(catalogFile);
  if (command === "update" && !values["offline-catalog"]) {
    catalog = await fetchCatalog();
  }
  catalog = selectPacks(catalog, config.packs);
  config.packs = catalog.packs.map(pack => pack.id);
  const setupHint = compatibilitySetupMessage(config.harness);
  if (setupHint) console.log(setupHint);
  for (const pack of catalog.packs) console.log(`Install ${pack.source}/${pack.path}@${pack.version} from verified commit ${pack.revision}`);
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
    const staging = await mkdtemp(join(tmpdir(), "boomkin-sources-"));
    const integrity: SkillIntegrity = {};
    try {
      // Resolve every source before installing; the installer receives only verified local checkouts.
      const sources = new Map<string, string>();
      const packages = new Map<string, string>();
      for (const pack of catalog.packs) {
        const key = `${pack.source}@${pack.revision}`;
        let checkout = sources.get(key);
        if (!checkout) {
          checkout = join(staging, `source-${sources.size}`);
          await checkoutPack(pack, checkout);
          sources.set(key, checkout);
        }
        packages.set(pack.id, await packageDirectory(pack, checkout));
      }
      for (const pack of catalog.packs) {
        await run(installArgs(packages.get(pack.id)!, config.harness, pack.skills));
        for (const skill of pack.skills) integrity[skill] = await verifyCopiedSkill(join(packages.get(pack.id)!, "skills", skill), join(directory, adapter.skillsPath, skill));
      }
    } finally { await rm(staging, { recursive: true, force: true }); }
    await verifyInstalled(catalog);
    for (const retired of ["lp-research", "lp-operate", "hyperliquid-research", "hyperliquid-operate"]) {
      if (await Bun.file(join(directory, adapter.skillsPath, retired, "SKILL.md")).exists()) console.log(`Legacy skill ${retired} remains. Review local edits and follow docs/UPDATES.md before removing it.`);
    }
    const identityPath = join(directory, config.harness === "eve" ? "agent/instructions.md" : "AGENTS.md");
    await mkdir(dirname(identityPath), { recursive: true });
    try { await writeFile(identityPath, identity, { flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; console.log(`Preserved ${identityPath}. Add the Boomkin identity from docs/IDENTITY.md if wanted.`); }
    await writeFile(join(stateDir, "last-sync.json.tmp"), JSON.stringify({ syncedAt: new Date().toISOString(), catalog, integrity }, null, 2) + "\n");
    await rename(join(stateDir, "last-sync.json.tmp"), join(stateDir, "last-sync.json"));
    console.log(`Skills ready in ${join(directory, adapter.skillsPath)}. Use the installed skill matching your task; infrastructure and data skills establish tool readiness and evidence first. Restart the harness to reload.${setupHint ? `\n${setupHint}` : ""}`);
  } finally { await rm(lock, { recursive: true }); }
}
main().catch(error => { console.error(`Boomkin: ${error.message}`); process.exitCode = 1; });
