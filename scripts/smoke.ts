import { mkdtemp, mkdir, readdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { harnesses } from "../src/core";

const root = await mkdtemp(join(tmpdir(), "wizzy-smoke-"));
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
      const p = Bun.spawn([process.execPath, cli, command, "--directory", directory, ...(command === "setup" ? ["--harness", name] : ["--offline-catalog"])], {
        env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), CODEX_HOME: join(home, ".codex") }, stdout: "pipe", stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      if (code !== 0) throw new Error(`${name} ${command}: ${stdout}\n${stderr}`);
      const entries = await readdir(join(directory, adapter.skillsPath));
      for (const skill of ["lp-research", "hyperliquid-research"]) {
        if (!entries.includes(skill)) throw new Error(`${name}: missing ${skill}`);
        if (!(await readFile(join(directory, adapter.skillsPath, skill, "SKILL.md"), "utf8")).includes("description:")) throw new Error("Missing skill metadata");
      }
      if (await readFile(instruction, "utf8") !== "Keep my existing instructions.\n") throw new Error("User instructions overwritten");
      console.log(`${name} ${command}: ${entries.length} skills; existing instructions preserved`);
    }
  }
} finally { await rm(root, { recursive: true, force: true }); }
