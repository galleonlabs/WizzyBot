import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_POLICY, loadConfig, policyFor } from "../src/config/policy.js";

describe("policy merge", () => {
  it("defaults then overlays an explicit file", () => {
    const dir = mkdtempSync(join(tmpdir(), "unabot-policy-"));
    const path = join(dir, "cfg.json");
    writeFileSync(
      path,
      JSON.stringify({
        defaults: { minFeeUsd: 9, oorPercent: 15, noFee: true },
        positions: { "42": { tokenId: "42", spendCapUsd: 12 } },
      }),
    );
    const cfg = loadConfig(path);
    expect(cfg.defaults.minFeeUsd).toBe(9);
    expect(cfg.defaults.oorPercent).toBe(15);
    expect(cfg.defaults.compound).toBe(DEFAULT_POLICY.compound);
    const p = policyFor(cfg, 42n);
    expect(p.tokenId).toBe("42");
    expect(p.spendCapUsd).toBe(12);
    expect(p.noFee).toBe(true);
    expect(p.minFeeUsd).toBe(9);
  });
});
