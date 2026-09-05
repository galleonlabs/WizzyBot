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
