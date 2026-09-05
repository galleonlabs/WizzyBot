import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("failed source fetch preserves successful sync and releases the operation lock", async () => {
  const { realpath, chmod, access } = await import("node:fs/promises");
  const directory = await realpath(await mkdtemp(join(tmpdir(), "boomkin-failed-install-")));
  const state = join(directory, ".boomkin");
  const bin = join(directory, "bin");
  try {
    await mkdir(state);
    await mkdir(bin);
    await writeFile(join(bin, "git"), "#!/bin/sh\nexit 1\n");
    await chmod(join(bin, "git"), 0o755);
    await writeFile(join(state, "config.json"), JSON.stringify({ schemaVersion: 1, harness: "eve", directory, packs: ["lp-skills"] }));
    const previous = JSON.stringify({ catalog: { schemaVersion: 2 }, syncedAt: "previous" });
    await writeFile(join(state, "last-sync.json"), previous);
    const child = Bun.spawn([process.execPath, "src/cli.ts", "update", "--directory", directory, "--offline-catalog"], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdout: "pipe", stderr: "pipe",
    });
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stderr).text()).toContain("no unverified source");
    expect(await readFile(join(state, "last-sync.json"), "utf8")).toBe(previous);
    await expect(access(join(state, "operation.lock"))).rejects.toThrow();
    expect(JSON.parse(await readFile(join(state, "config.json"), "utf8")).packs).toEqual(["lp-skills"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
