import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOLD_LIMITATION,
  formatHoldNote,
  getHold,
  holdAmounts,
  holdIsReconstructed,
  rememberHold,
} from "../src/core/hold.js";

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), "unabot-hold-")), "positions.json");
}

describe("HOLD persistence", () => {
  it("persists first-seen amounts and never overwrites", () => {
    const path = tmpPath();
    const first = rememberHold(99n, 100n, 200n, "increase-liquidity-log", { path, createdAt: 1_700_000_000 });
    expect(first.created).toBe(true);
    expect(holdIsReconstructed(first.record)).toBe(true);
    const second = rememberHold(99n, 1n, 1n, "first-seen-import", { path });
    expect(second.created).toBe(false);
    expect(second.record.hold0).toBe("100");
    expect(second.record.hold1).toBe("200");
    expect(holdAmounts(getHold(99n, path)!)).toEqual({ hold0: 100n, hold1: 200n });
  });

  it("labels first-seen import as not the original mint bag", () => {
    const path = tmpPath();
    const rec = rememberHold(7n, 5n, 6n, "first-seen-import", { path }).record;
    expect(holdIsReconstructed(rec)).toBe(false);
    expect(formatHoldNote(rec)).toMatch(/first-seen|not the original/i);
    expect(formatHoldNote(undefined)).toBe(HOLD_LIMITATION);
    expect(HOLD_LIMITATION).toMatch(/never silently/);
  });
});
