import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("curator service validation", () => {
  it("runs the repository Vitest script instead of Bun's incompatible test runner", async () => {
    const script = await readFile("scripts/run-curator-service.sh", "utf8");

    expect(script).toContain('"${UNABOT_BUN_BIN}" run test');
    expect(script).not.toContain('"${UNABOT_BUN_BIN}" test');
  });

  it("repeats executable discovery constraints immediately before agent output", async () => {
    const script = await readFile("scripts/run-curator-service.sh", "utf8");

    expect(script).toContain("Final output gate");
    expect(script).toContain("executionReady=true and protocol=V3");
    expect(script).toContain("previously reviewed candidate registry entry");
  });
});
