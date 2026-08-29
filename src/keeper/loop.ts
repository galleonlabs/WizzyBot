import { isAddress, getAddress, type Address } from "viem";
import { planCompound, planExit, planRerange } from "../core/actions.js";
import { cooldownBlocked } from "../core/economics.js";
import { COMPOUND_FEE_BPS, NOTIONAL_FEE_BPS, RANGE_EXIT_FEE_BPS } from "../core/fees.js";
import { parseProtocol } from "../core/protocol.js";
import {
  loadConfig,
  policyFor,
  markRun,
  saveConfig,
  copyPolicyToNewToken,
} from "../config/policy.js";
import type {
  ActionReceipt,
  AlertSink,
  PositionSnapshot,
  SkipReason,
  UnaBotConfig,
} from "../types.js";
import { alert } from "./alerts.js";
import { safeExecute, type SafeExecuteDeps } from "./execute.js";
import { skippedReceipt, withSkipReason } from "./skip.js";

export interface KeeperPrices {
  feesUsd: number;
  notionalUsd: number;
  gasUsd: number;
  price: number;
  priceImpactBps?: number;
}

export interface KeeperDeps {
  list: (owner: Address) => Promise<PositionSnapshot[]>;
  owner: Address;
  live: boolean;
  intervalMs: number;
  sink: AlertSink;
  execute?: (receipt: ActionReceipt, position: PositionSnapshot) => Promise<ActionReceipt>;
  prices: (p: PositionSnapshot) => Promise<KeeperPrices>;
  config?: UnaBotConfig;
  hasSigner?: boolean;
  saveConfig?: (cfg: UnaBotConfig) => void;
  hydrate?: SafeExecuteDeps["hydrate"];
  send?: SafeExecuteDeps["send"];
}

function cfgOf(deps: Pick<KeeperDeps, "config">): UnaBotConfig {
  return deps.config ?? loadConfig();
}

function persist(cfg: UnaBotConfig, deps: Pick<KeeperDeps, "config" | "saveConfig">): void {
  if (deps.saveConfig) {
    deps.saveConfig(cfg);
    return;
  }
  if (!deps.config) saveConfig(cfg);
}

function logDecision(sink: AlertSink, receipt: ActionReceipt): void {
  const stamped = withSkipReason(receipt);
  const kind = stamped.skipped ? "skip" : "execute";
  const level = stamped.skipped ? "info" : "warn";
  alert(sink, level, kind, stamped.reason ?? stamped.action, stamped.tokenId !== undefined ? String(stamped.tokenId) : undefined, {
    action: stamped.action,
    skipped: stamped.skipped,
    skipReason: stamped.skipReason,
    dryRun: stamped.dryRun,
  });
}

function skip(
  action: ActionReceipt["action"],
  deps: Pick<KeeperDeps, "live" | "owner" | "sink">,
  tokenId: bigint,
  skipReason: SkipReason,
  reason: string,
): ActionReceipt {
  const receipt = skippedReceipt({
    action,
    dryRun: !deps.live,
    reason,
    skipReason,
    tokenId,
    from: deps.owner,
  });
  logDecision(deps.sink, receipt);
  return receipt;
}

export async function decideForPosition(
  position: PositionSnapshot,
  deps: Omit<KeeperDeps, "list" | "intervalMs" | "execute" | "saveConfig" | "hydrate" | "send">,
): Promise<ActionReceipt[]> {
  const cfg = cfgOf(deps);
  const policy = policyFor(cfg, position.ref.tokenId);

  if (policy.protocol && parseProtocol(policy.protocol) !== position.ref.protocol) {
    return [
      skip(
        "simulate",
        deps,
        position.ref.tokenId,
        "protocol",
        `protocol: policy=${policy.protocol} position=${position.ref.protocol}`,
      ),
    ];
  }

  if (cooldownBlocked(policy.lastRunAt, policy.cooldownSec)) {
    return [
      skip(
        "simulate",
        deps,
        position.ref.tokenId,
        "cooldown",
        `cooldown: ${policy.cooldownSec}s`,
      ),
    ];
  }

  const px = await deps.prices(position);

  if (px.notionalUsd > policy.spendCapUsd) {
    return [
      skip(
        "simulate",
        deps,
        position.ref.tokenId,
        "spend_cap",
        `spend_cap: notional $${px.notionalUsd.toFixed(2)} > spendCapUsd $${policy.spendCapUsd}`,
      ),
    ];
  }
  if ((policy.spentUsd ?? 0) + px.gasUsd > policy.spendCapUsd) {
    return [
      skip(
        "simulate",
        deps,
        position.ref.tokenId,
        "spend_cap",
        `spend_cap: spent $${(policy.spentUsd ?? 0).toFixed(2)} + gas $${px.gasUsd.toFixed(4)} > spendCapUsd $${policy.spendCapUsd}`,
      ),
    ];
  }

  if (px.priceImpactBps !== undefined && px.priceImpactBps > policy.maxPriceImpactBps) {
    return [
      skip(
        "simulate",
        deps,
        position.ref.tokenId,
        "price_impact",
        `price_impact: ${px.priceImpactBps}bps > maxPriceImpactBps ${policy.maxPriceImpactBps}`,
      ),
    ];
  }

  if (deps.live && deps.hasSigner === false) {
    return [
      skip(
        "simulate",
        deps,
        position.ref.tokenId,
        "missing_key",
        "missing_key: signer required for --live",
      ),
    ];
  }

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
    const exit = withSkipReason(
      planExit(position, ctx, {
        exitPrice: policy.exitPrice,
        currentPrice: px.price,
        swapTo: policy.exitToken && isAddress(policy.exitToken) ? getAddress(policy.exitToken) : undefined,
      }),
    );
    logDecision(deps.sink, exit);
    out.push(exit);
    if (!exit.skipped) return out;
  }

  if (policy.autoRange) {
    const rerange = withSkipReason(planRerange(position, ctx, { oorPercent: policy.oorPercent }));
    logDecision(deps.sink, rerange);
    out.push(rerange);
    if (!rerange.skipped) return out;
  }

  if (policy.compound) {
    const compound = withSkipReason(planCompound(position, { ...ctx, takeBps: COMPOUND_FEE_BPS }));
    logDecision(deps.sink, compound);
    out.push(compound);
  }

  return out;
}

export async function runOnce(deps: KeeperDeps): Promise<ActionReceipt[]> {
  const positions = await deps.list(deps.owner);
  const all: ActionReceipt[] = [];
  let cfg = cfgOf(deps);
  for (const position of positions) {
    const decisions = await decideForPosition(position, { ...deps, config: cfg });
    for (const decision of decisions) {
      if (!decision.skipped && deps.live && deps.hasSigner === false) {
        const blocked = skippedReceipt({
          action: decision.action,
          dryRun: false,
          reason: "missing_key: signer required for --live",
          skipReason: "missing_key",
          tokenId: decision.tokenId ?? position.ref.tokenId,
          from: deps.owner,
        });
        logDecision(deps.sink, blocked);
        all.push(blocked);
        continue;
      }
      if (!decision.skipped && deps.live) {
        const executed = withSkipReason(
          deps.execute
            ? await deps.execute(decision, position)
            : await safeExecute(decision, position, {
                live: deps.live,
                hasSigner: deps.hasSigner !== false,
                hydrate: deps.hydrate,
                send: deps.send,
              }),
        );
        all.push(executed);
        if (executed.skipped) {
          logDecision(deps.sink, executed);
          continue;
        }
        if (executed.action === "rerange" && executed.newTokenId) {
          cfg = copyPolicyToNewToken(cfg, String(position.ref.tokenId), String(executed.newTokenId));
        }
        cfg = markRun(cfg, String(position.ref.tokenId));
        persist(cfg, deps);
      } else {
        all.push(decision);
      }
    }
  }
  return all;
}

export async function runLoop(deps: KeeperDeps, signal?: AbortSignal): Promise<void> {
  alert(
    deps.sink,
    "info",
    "keeper",
    `Uniswap LP on autopilot. starting loop interval=${deps.intervalMs}ms live=${deps.live}`,
    undefined,
    { dryRun: !deps.live },
  );
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
