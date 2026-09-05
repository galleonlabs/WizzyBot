import { type Pack } from "./core.ts";

export async function git(args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, , status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (status !== 0) throw new Error("Unable to fetch or verify the published skill revision; no unverified source will be installed.");
  return stdout.trim();
}
export async function checkoutPack(pack: Pack, directory: string, run = git): Promise<void> {
  await run(["init", "--quiet", directory]);
  await run(["-C", directory, "fetch", "--quiet", "--depth=1", "--no-tags", `https://github.com/${pack.source}.git`, pack.revision]);
  await run(["-C", directory, "checkout", "--quiet", "--detach", "FETCH_HEAD"]);
  const actual = await run(["-C", directory, "rev-parse", "HEAD"]);
  if (actual !== pack.revision) throw new Error(`Downloaded revision mismatch for ${pack.id}; no unverified source will be installed.`);
}

// Verify package boundaries and release metadata before handing any source to the installer.
export async function packageDirectory(pack: Pack, checkout: string): Promise<string> {
  const { readFile, realpath, readdir } = await import("node:fs/promises");
  const { join, relative, isAbsolute } = await import("node:path");
  const root = await realpath(checkout);
  const path = await realpath(join(root, pack.path));
  const rel = relative(root, path);
  if (path !== join(root, pack.path) || !rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Package path escapes checkout: ${pack.id}`);
  async function rejectLinks(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Package contains a symbolic link: ${pack.id}`);
      if (entry.isDirectory()) await rejectLinks(join(directory, entry.name));
    }
  }
  await rejectLinks(path);
  const manifest = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
  if (manifest.name !== pack.package || manifest.version !== pack.version) throw new Error(`Package release metadata mismatch: ${pack.id}`);
  const { installedVersion } = await import("./core.ts");
  for (const skill of pack.skills) {
    const text = await readFile(join(path, "skills", skill, "SKILL.md"), "utf8");
    if (installedVersion(text) !== pack.version) throw new Error(`Source skill version mismatch: ${skill}`);
  }
  return path;
}
