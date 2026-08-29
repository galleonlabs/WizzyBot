import type { ActionReceipt, PlannedTx, PositionSnapshot } from "../types.js";
import { isPlaceholderTx } from "../signer/broadcast.js";
import { skippedReceipt, withSkipReason } from "./skip.js";

export interface SafeExecuteDeps {
  live: boolean;
  hasSigner: boolean;
  hydrate?: (receipt: ActionReceipt, position: PositionSnapshot) => ActionReceipt | Promise<ActionReceipt>;
  send?: (tx: PlannedTx) => Promise<{ hash?: string; dryRun?: boolean }>;
}

/** Live path: never broadcast empty calldata; skip if the signer key is missing. */
export async function safeExecute(
  receipt: ActionReceipt,
  position: PositionSnapshot,
  deps: SafeExecuteDeps,
): Promise<ActionReceipt> {
  if (receipt.skipped) return withSkipReason(receipt);
  if (!deps.live) return receipt;

  if (!deps.hasSigner) {
    return skippedReceipt({
      action: receipt.action,
      dryRun: false,
      reason: "missing_key: signer required for --live",
      skipReason: "missing_key",
      tokenId: receipt.tokenId ?? position.ref.tokenId,
      from: receipt.from,
    });
  }

  const filled = deps.hydrate ? await deps.hydrate(receipt, position) : receipt;
  const sendable = filled.txs.filter((tx) => !isPlaceholderTx(tx));
  const placeholders = filled.txs.filter((tx) => isPlaceholderTx(tx));

  if (sendable.length === 0) {
    return skippedReceipt({
      action: filled.action,
      dryRun: false,
      reason: placeholders.length
        ? "placeholder_calldata: refusing empty calldata"
        : "placeholder_calldata: no fillable txs",
      skipReason: "placeholder_calldata",
      tokenId: filled.tokenId ?? position.ref.tokenId,
      from: filled.from,
    });
  }

  if (!deps.send) {
    return { ...filled, skipped: false };
  }

  let lastHash: ActionReceipt["hash"];
  for (const tx of sendable) {
    if (isPlaceholderTx(tx)) {
      throw new Error(`placeholder_calldata: refusing empty calldata to ${tx.to}`);
    }
    const sent = await deps.send(tx);
    if (sent.hash) lastHash = sent.hash as ActionReceipt["hash"];
  }

  return {
    ...filled,
    skipped: false,
    dryRun: false,
    txs: sendable,
    hash: lastHash,
  };
}

export function filterSendable(txs: PlannedTx[]): { sendable: PlannedTx[]; placeholders: PlannedTx[] } {
  const sendable: PlannedTx[] = [];
  const placeholders: PlannedTx[] = [];
  for (const tx of txs) {
    if (isPlaceholderTx(tx)) placeholders.push(tx);
    else sendable.push(tx);
  }
  return { sendable, placeholders };
}
