import { describe, expect, it } from "vitest";
import { cooldownBlocked, evaluateEconomics } from "../src/core/economics.js";

describe("uneconomic skip", () => {
  it("skips when net fees after gas are below minFeeUsd", () => {
    const decision = evaluateEconomics({
      feesUsd: 2,
      notionalUsd: 500,
      gasUsd: 1.5,
      minFeeUsd: 1,
      minPositionUsd: 50,
      takeBps: 0,
      noFee: true,
    });
    // net = 2 - 1.5 = 0.5 < 1
    expect(decision.skip).toBe(true);
    expect(decision.reason).toMatch(/uneconomic/);
  });

  it("skips tiny positions (size floor)", () => {
    const decision = evaluateEconomics({
      feesUsd: 5,
      notionalUsd: 10,
      gasUsd: 0.1,
      minFeeUsd: 1,
      minPositionUsd: 50,
      takeBps: 0,
      noFee: true,
    });
    expect(decision.skip).toBe(true);
    expect(decision.reason).toMatch(/size floor/);
  });

  it("executes when net covers the floor", () => {
    const decision = evaluateEconomics({
      feesUsd: 20,
      notionalUsd: 500,
      gasUsd: 0.2,
      minFeeUsd: 1,
      minPositionUsd: 50,
      takeBps: 0,
      noFee: true,
    });
    expect(decision.skip).toBe(false);
    expect(decision.takeUsd).toBe(0);
    expect(decision.netUsd).toBeGreaterThan(1);
  });

  it("skips when there are no fees", () => {
    const decision = evaluateEconomics({
      feesUsd: 0,
      notionalUsd: 500,
      gasUsd: 0.1,
      minFeeUsd: 1,
      minPositionUsd: 50,
      takeBps: 200,
      noFee: true,
    });
    expect(decision.skip).toBe(true);
    expect(decision.reason).toMatch(/no uncollected fees/);
  });

  it("ignores legacy take configuration when product fees are disabled", () => {
    const decision = evaluateEconomics({
      feesUsd: 20,
      notionalUsd: 10_000,
      gasUsd: 0.2,
      minFeeUsd: 1,
      minPositionUsd: 50,
      takeBps: 15,
      noFee: true,
      takeBaseUsd: 10_000,
    });
    expect(decision.takeUsd).toBe(0);
    expect(decision.netUsd).toBeCloseTo(19.8);
    expect(decision.skip).toBe(false);
  });

  it("blocks cooldown until the window elapses", () => {
    expect(cooldownBlocked(100, 60, 130)).toBe(true);
    expect(cooldownBlocked(100, 60, 161)).toBe(false);
    expect(cooldownBlocked(undefined, 60, 200)).toBe(false);
  });
});
