import type { ActionReceipt, SkipReason } from "../types.js";
import type { Address } from "viem";

export const SKIP_REASONS = [
  "uneconomic",
  "cooldown",
  "missing_key",
  "placeholder_calldata",
  "spend_cap",
  "price_impact",
  "protocol",
] as const;

export function classifySkip(reason?: string): SkipReason | undefined {
  if (!reason) return undefined;
  const r = reason.toLowerCase();
  if (r.includes("placeholder") || r.includes("empty calldata")) return "placeholder_calldata";
  if (r.includes("missing_key") || r.includes("missing key") || r.includes("private_key required")) {
    return "missing_key";
  }
  if (r.includes("cooldown")) return "cooldown";
  if (r.includes("spend_cap") || r.includes("spend cap")) return "spend_cap";
  if (r.includes("price_impact") || r.includes("price impact")) return "price_impact";
  if (r.startsWith("protocol:") || r.includes("protocol mismatch")) return "protocol";
  if (r.includes("uneconomic") || r.includes("size floor") || r.includes("no uncollected")) {
    return "uneconomic";
  }
  return undefined;
}

export function skippedReceipt(args: {
  action: ActionReceipt["action"];
  dryRun: boolean;
  reason: string;
  skipReason: SkipReason;
  tokenId?: bigint;
  from: Address;
}): ActionReceipt {
  return {
    action: args.action,
    dryRun: args.dryRun,
    skipped: true,
    reason: args.reason,
    skipReason: args.skipReason,
    tokenId: args.tokenId,
    from: args.from,
    to: [],
    actions: [],
    treasuryFee: null,
    txs: [],
  };
}

export function withSkipReason(receipt: ActionReceipt): ActionReceipt {
  if (!receipt.skipped) return receipt;
  const skipReason = receipt.skipReason ?? classifySkip(receipt.reason);
  return skipReason ? { ...receipt, skipReason } : receipt;
}
