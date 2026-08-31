import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const agentDirs = ["agent/tools", "agent/schedules", "agent/lib"];
const bundlePath = "vendor/hosted-cjs/index.cjs";

function agentSources(): string[] {
  const files: string[] = [];
  for (const dir of agentDirs) {
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".ts")) files.push(path.join(dir, name));
    }
  }
  return files;
}

function ensureHostedBundle() {
  execFileSync("node", ["scripts/bundle-hosted.mjs"], { stdio: "inherit" });
}

describe("eve hosted CJS isolation", () => {
  it("keeps Uniswap SDK out of eve authored modules", () => {
    const blocked = [
      "@uniswap/sdk-core",
      "@uniswap/v3-sdk",
      "src/surfaces/hosted",
      "surfaces/hosted",
    ];
    for (const file of agentSources()) {
      const src = readFileSync(file, "utf8");
      for (const needle of blocked) {
        if (file.endsWith("hosted.ts") && needle.includes("hosted")) continue;
        expect(src, file).not.toContain(needle);
      }
    }
    const loader = readFileSync("agent/lib/hosted.ts", "utf8");
    expect(loader).toContain('import hostedCjs from "../../vendor/hosted-cjs/index.cjs"');
    expect(loader).not.toContain("createRequire");
  });

  it("loads the CJS surface without Uniswap ESM", () => {
    ensureHostedBundle();
    expect(existsSync(bundlePath)).toBe(true);
    expect(existsSync("node_modules/unabot-hosted-cjs/index.cjs")).toBe(true);
    const require = createRequire(import.meta.url);
    const fromVendor = require("../vendor/hosted-cjs/index.cjs") as {
      assertWriteAllowed: (flags: { live?: boolean; confirm?: boolean }) => boolean;
    };
    const hosted = require("unabot-hosted-cjs") as {
      assertWriteAllowed: (flags: { live?: boolean; confirm?: boolean }) => boolean;
    };
    expect(fromVendor.assertWriteAllowed({})).toBe(false);
    expect(hosted.assertWriteAllowed({})).toBe(false);
    expect(hosted.assertWriteAllowed({ live: false })).toBe(false);
    expect(() => hosted.assertWriteAllowed({ live: true })).toThrow(/confirm=true/);
    expect(hosted.assertWriteAllowed({ live: true, confirm: true })).toBe(true);
    const bundle = readFileSync(bundlePath, "utf8");
    expect(bundle).toMatch(/compoundPosition|assertWriteAllowed/);
    expect(bundle.includes('require("@uniswap/sdk-core")')).toBe(false);
  });
});


function walkAppSources(dir = "app"): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      files.push(...walkAppSources(full));
    } else if (name.endsWith(".ts") || name.endsWith(".tsx") || name.endsWith(".css")) {
      files.push(full);
    }
  }
  return files;
}

describe("hosted UI isolation", () => {
  it("keeps Uniswap SDK out of client UI and API routes", () => {
    const blocked = ["@uniswap/sdk-core", "@uniswap/v3-sdk", "src/surfaces/hosted"];
    for (const file of walkAppSources()) {
      const src = readFileSync(file, "utf8");
      for (const needle of blocked) {
        expect(src, file).not.toContain(needle);
      }
      expect(src, file).not.toMatch(/#ff007a/i);
    }
    const loader = readFileSync("app/lib/hosted-server.ts", "utf8");
    expect(loader).toContain("createRequire");
    expect(loader).toContain("../../vendor/hosted-cjs/index.cjs");
  });
});
