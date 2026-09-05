import { expect, test } from "bun:test";
import { checkoutPack } from "../src/source";
import { parseCatalog } from "../src/core";
import catalog from "../catalog/skills.json";

test("a mismatched downloaded commit cannot reach installation", async () => {
  const pack = parseCatalog(catalog).packs[0]!;
  await expect(checkoutPack(pack, "/tmp/test-checkout", async args => args.includes("rev-parse") ? "wrong-commit" : "")).rejects.toThrow("mismatch");
});
test("source is resolved by commit, independent of release tag names", async () => {
  const pack = parseCatalog(catalog).packs[0]!;
  const commands: string[][] = [];
  await checkoutPack(pack, "/tmp/test-checkout", async args => { commands.push(args); return args.includes("rev-parse") ? pack.revision : ""; });
  expect(commands.find(args => args.includes("fetch"))?.at(-1)).toBe(pack.revision);
  expect(commands.some(args => args.includes(`v${pack.version}`))).toBe(false);
});
