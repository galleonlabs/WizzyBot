import { mkdtemp, mkdir, readdir, rm, readFile, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { harnesses, parseCatalog } from "../src/core";

import catalogFile from "../catalog/skills.json";

const root = await mkdtemp(join(tmpdir(), "boomkin-smoke-"));
const cli = resolve(import.meta.dir, "../src/cli.ts");
try {
  const home = join(root, "home");
  await mkdir(home);
  for (const [name, adapter] of Object.entries(harnesses)) {
    const directory = join(root, name);
    await mkdir(directory);
    const instruction = join(directory, name === "eve" ? "agent/instructions.md" : "AGENTS.md");
    await mkdir(resolve(instruction, ".."), { recursive: true });
    await writeFile(instruction, "Keep my existing instructions.\n");
    for (const command of ["setup", "update"] as const) {
      if (command === "update" && name === "eve") {
        // Exercise an existing installation's legacy state migration on a real update.
        const configPath = join(directory, ".boomkin/config.json");
        const legacyConfig = JSON.parse(await readFile(configPath, "utf8"));
        delete legacyConfig.packs;
        await writeFile(configPath, JSON.stringify(legacyConfig));
        await rename(join(directory, ".boomkin"), join(directory, ".wizzy"));
      }
      if (command === "update" && name === "hermes") await writeFile(join(directory, ".boomkin/last-sync.json"), "{broken");
      const p = Bun.spawn([process.execPath, cli, command, "--directory", directory, ...(command === "setup" ? ["--harness", name] : ["--offline-catalog"])], {
        env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), CODEX_HOME: join(home, ".codex") }, stdout: "pipe", stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      if (code !== 0) throw new Error(`${name} ${command}: ${stdout}\n${stderr}`);
      const entries = await readdir(join(directory, adapter.skillsPath));
      for (const skill of parseCatalog(catalogFile).packs.flatMap(p => p.skills)) {
        if (!entries.includes(skill)) throw new Error(`${name}: missing ${skill}`);
        if (!(await readFile(join(directory, adapter.skillsPath, skill, "SKILL.md"), "utf8")).includes("description:")) throw new Error("Missing skill metadata");
      }
      if (await readFile(instruction, "utf8") !== "Keep my existing instructions.\n") throw new Error("User instructions overwritten");
      console.log(`${name} ${command}: ${entries.length} skills; existing instructions preserved`);
    }
  }
  for (const selected of parseCatalog(catalogFile).packs) {
    const directory = join(root, selected.id);
    for (const command of ["setup", "update"] as const) {
      const p = Bun.spawn([process.execPath, cli, command, "--directory", directory, ...(command === "setup" ? ["--harness", "codex", "--pack", selected.id] : ["--offline-catalog"])], {
        env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), CODEX_HOME: join(home, ".codex") }, stdout: "pipe", stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      if (code !== 0) throw new Error(`selected ${command}: ${stdout}\n${stderr}`);
      const entries = await readdir(join(directory, ".agents/skills"));
      const expected = selected.skills;
      if (JSON.stringify(entries.sort()) !== JSON.stringify([...expected].sort())) throw new Error(`Selected install leaked another package: ${entries.join(", ")}`);
      const config = JSON.parse(await readFile(join(directory, ".boomkin/config.json"), "utf8"));
      if (JSON.stringify(config.packs) !== JSON.stringify([selected.id])) throw new Error("Saved pack selection changed");
      console.log(`${selected.id} ${command}: exactly ${entries.length} skills; selection preserved`);
    }
  }

} finally { await rm(root, { recursive: true, force: true }); }
