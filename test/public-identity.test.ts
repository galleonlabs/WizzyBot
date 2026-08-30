import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const SHIPPED_ROOTS = ["app", "public", "src"];
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".md", ".mjs", ".svg", ".ts", ".tsx"]);
const PUBLIC_IDENTITY = /andrew\s*wilkinson|andrewwilkinson|adwilkinson|galleon(?:\s*labs|labs)?/i;

function textFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return textFiles(path);
    return TEXT_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

describe("public identity boundary", () => {
  it("keeps personal and parent-organization identities out of shipped surfaces", () => {
    const leaks = SHIPPED_ROOTS.flatMap(textFiles).flatMap((path) => {
      const match = readFileSync(path, "utf8").match(PUBLIC_IDENTITY);
      return match ? [`${path}: ${match[0]}`] : [];
    });

    expect(leaks).toEqual([]);
  });
});
