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

describe("per-position policy", () => {
  it("overlays compound / range / exit plus production bounds and protocol", () => {
    const dir = mkdtempSync(join(tmpdir(), "unabot-policy-"));
    const path = join(dir, "cfg.json");
    writeFileSync(
      path,
      JSON.stringify({
        defaults: {
          minFeeUsd: 1,
          maxPriceImpactBps: 50,
          cooldownSec: 3600,
          oorPercent: 0,
          spendCapUsd: 10000,
          compound: true,
          autoRange: true,
          autoExit: false,
        },
        positions: {
          "42": {
            tokenId: "42",
            protocol: "v3",
            compound: true,
            autoRange: false,
            autoExit: true,
            minFeeUsd: 5,
            maxPriceImpactBps: 25,
            cooldownSec: 120,
            oorPercent: 10,
            spendCapUsd: 500,
          },
          "99": { tokenId: "99", protocol: "V2" },
        },
      }),
    );
    const cfg = loadConfig(path);
    const v3 = policyFor(cfg, 42n);
    expect(v3.protocol).toBe("v3");
    expect(v3.compound).toBe(true);
    expect(v3.autoRange).toBe(false);
    expect(v3.autoExit).toBe(true);
    expect(v3.minFeeUsd).toBe(5);
    expect(v3.maxPriceImpactBps).toBe(25);
    expect(v3.cooldownSec).toBe(120);
    expect(v3.oorPercent).toBe(10);
    expect(v3.spendCapUsd).toBe(500);

    const v2 = policyFor(cfg, "99");
    expect(v2.protocol).toBe("v2");
    expect(v2.compound).toBe(true);
    expect(v2.autoRange).toBe(true);
    expect(v2.minFeeUsd).toBe(1);
  });
});
