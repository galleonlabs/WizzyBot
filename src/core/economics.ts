import { bpsOf } from "./fees.js";
import type { EconomicsDecision, EconomicsInput } from "../types.js";

export function evaluateEconomics(input: EconomicsInput): EconomicsDecision {
  if (input.notionalUsd < input.minPositionUsd) {
    return {
      skip: true,
      reason: `size floor: position $${input.notionalUsd.toFixed(2)} < minPositionUsd $${input.minPositionUsd}`,
      takeUsd: 0,
      netUsd: 0,
    };
  }

  const takeBaseUsd = input.takeBaseUsd ?? input.feesUsd;
  const takeUsd = input.noFee
    ? 0
    : Number(bpsOf(BigInt(Math.round(Math.max(0, takeBaseUsd) * 1e6)), input.takeBps)) / 1e6;
  const netUsd = input.feesUsd - takeUsd - input.gasUsd;

  if (input.feesUsd <= 0) {
    return {
      skip: true,
      reason: "no uncollected fees",
      takeUsd,
      netUsd,
    };
  }

  if (netUsd < input.minFeeUsd) {
    return {
      skip: true,
      reason: `uneconomic: net $${netUsd.toFixed(4)} after gas $${input.gasUsd.toFixed(4)} and ${input.takeBps / 100}% take < minFeeUsd $${input.minFeeUsd}`,
      takeUsd,
      netUsd,
    };
  }

  return { skip: false, takeUsd, netUsd };
}

export function cooldownBlocked(lastRunAt: number | undefined, cooldownSec: number, now = Date.now() / 1000): boolean {
  if (!lastRunAt || cooldownSec <= 0) return false;
  return now - lastRunAt < cooldownSec;
}
