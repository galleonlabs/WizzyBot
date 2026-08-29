import { isAddress, getAddress, type Address } from "viem";
import { planCompound, planExit, planRerange, formatReceipt } from "../core/actions.js";
import { cooldownBlocked } from "../core/economics.js";
import { COMPOUND_FEE_BPS, NOTIONAL_FEE_BPS, RANGE_EXIT_FEE_BPS } from "../core/fees.js";
import { loadConfig, policyFor, markRun, saveConfig, copyPolicyToNewToken } from "../config/policy.js";
import type { ActionReceipt, AlertSink, PositionSnapshot } from "../types.js";
import { alert } from "./alerts.js";

export interface KeeperDeps {
  list: (owner: Address) => Promise<PositionSnapshot[]>;
  owner: Address;
  live: boolean;
  intervalMs: number;
  sink: AlertSink;
  execute?: (receipt: ActionReceipt) => Promise<ActionReceipt>;
  prices: (p: PositionSnapshot) => Promise<{ feesUsd: number; notionalUsd: number; gasUsd: number; price: number }>;
}

export async function decideForPosition(
  position: PositionSnapshot,
  deps: Omit<KeeperDeps, "list" | "intervalMs" | "execute">,
): Promise<ActionReceipt[]> {
  const cfg = loadConfig();
  const policy = policyFor(cfg, position.ref.tokenId);
  if (cooldownBlocked(policy.lastRunAt, policy.cooldownSec)) {
    const receipt: ActionReceipt = {
      action: "simulate",
      dryRun: !deps.live,
      skipped: true,
      reason: `cooldown ${policy.cooldownSec}s`,
      tokenId: position.ref.tokenId,
      from: deps.owner,
      to: [],
      actions: [],
      treasuryFee: null,
      txs: [],
    };
    alert(deps.sink, "info", "skip", receipt.reason ?? "cooldown", String(position.ref.tokenId));
    return [receipt];
  }

  const px = await deps.prices(position);
  const ctx = {
    owner: deps.owner,
    dryRun: !deps.live,
    noFee: policy.noFee,
    feeSource: policy.feeSource,
    minFeeUsd: policy.minFeeUsd,
    minPositionUsd: policy.minPositionUsd,
    feesUsd: px.feesUsd,
    notionalUsd: px.notionalUsd,
    gasUsd: px.gasUsd,
    takeBps: policy.feeSource === "notional" ? NOTIONAL_FEE_BPS : policy.autoExit || policy.autoRange ? RANGE_EXIT_FEE_BPS : COMPOUND_FEE_BPS,
    takeBaseUsd: policy.feeSource === "notional" ? px.notionalUsd : px.feesUsd,
  };

  const out: ActionReceipt[] = [];

  if (policy.autoExit && policy.exitPrice) {
    const exit = planExit(position, ctx, {
      exitPrice: policy.exitPrice,
      currentPrice: px.price,
      swapTo: policy.exitToken && isAddress(policy.exitToken) ? getAddress(policy.exitToken) : undefined,
    });
    logDecision(deps.sink, exit);
    out.push(exit);
    if (!exit.skipped) return out;
  }

  if (policy.autoRange) {
    const rerange = planRerange(position, ctx, { oorPercent: policy.oorPercent });
    logDecision(deps.sink, rerange);
    out.push(rerange);
    if (!rerange.skipped) return out;
  }

  if (policy.compound) {
    const compound = planCompound(position, { ...ctx, takeBps: COMPOUND_FEE_BPS });
    logDecision(deps.sink, compound);
    out.push(compound);
  }

  return out;
}

function logDecision(sink: AlertSink, receipt: ActionReceipt): void {
  const kind = receipt.skipped ? "skip" : "execute";
  const level = receipt.skipped ? "info" : "warn";
  alert(
    sink,
    level,
    kind,
    formatReceipt(receipt),
    receipt.tokenId !== undefined ? String(receipt.tokenId) : undefined,
  );
}

export async function runOnce(deps: KeeperDeps): Promise<ActionReceipt[]> {
  const positions = await deps.list(deps.owner);
  const all: ActionReceipt[] = [];
  let cfg = loadConfig();
  for (const position of positions) {
    const decisions = await decideForPosition(position, deps);
    for (const decision of decisions) {
      if (!decision.skipped && deps.execute) {
        const executed = await deps.execute(decision);
        all.push(executed);
        if (executed.action === "rerange" && executed.newTokenId) {
          cfg = copyPolicyToNewToken(cfg, String(position.ref.tokenId), String(executed.newTokenId));
        }
        cfg = markRun(cfg, String(position.ref.tokenId));
        saveConfig(cfg);
      } else {
        all.push(decision);
      }
    }
  }
  return all;
}

export async function runLoop(deps: KeeperDeps, signal?: AbortSignal): Promise<void> {
  alert(deps.sink, "info", "keeper", `starting loop interval=${deps.intervalMs}ms live=${deps.live}`);
  while (!signal?.aborted) {
    try {
      await runOnce(deps);
    } catch (err) {
      alert(deps.sink, "error", "keeper", err instanceof Error ? err.message : String(err));
    }
    await sleep(deps.intervalMs, signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}
