import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertWriteAllowed, runKeeperScan } from "../src/surfaces/hosted.js";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const target = path.join(directory, name);
    if (statSync(target).isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx|js|mjs|cjs)$/.test(name) ? [target] : [];
  });
}

describe("external EOA runtime", () => {
  it("contains no Privy runtime, dependency, or server signer", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencyNames = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    });
    expect(dependencyNames.some((name) => name.toLowerCase().includes("privy"))).toBe(false);
    expect(existsSync("src/signer/privy.ts")).toBe(false);

    for (const file of ["app", "agent", "src"].flatMap(sourceFiles)) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/privy/i);
    }
  });

  it("requires confirmation to prepare an EOA wallet plan", () => {
    expect(assertWriteAllowed({})).toBe(false);
    expect(assertWriteAllowed({ live: false })).toBe(false);
    expect(() => assertWriteAllowed({ live: true })).toThrow(/connected EOA/i);
    expect(assertWriteAllowed({ live: true, confirm: true })).toBe(true);
  });

  it("refuses server-side keeper execution", async () => {
    await expect(runKeeperScan({
      owner: "0x1111111111111111111111111111111111111111",
      chain: "base",
      live: true,
    })).rejects.toThrow(/connected EOA/i);
  });
});
