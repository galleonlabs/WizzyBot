import type { Config } from "wagmi";
import { estimateGas, getAccount, sendTransaction, switchChain, waitForTransactionReceipt } from "wagmi/actions";

export type WalletTransaction = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  description: string;
};

export type PlanSubmission = {
  chainId: number;
  transactionHashes: `0x${string}`[];
};

export type PlanProgress = {
  step: number;
  total: number;
  description: string;
};

/**
 * Execute a server-quoted plan through the user's own wallet, one transaction
 * per confirmation. External wallets pay their own gas; nothing is sponsored
 * and no key ever leaves the wallet. Each transaction must land with a
 * successful receipt before the next is offered.
 */
export async function sendPlanTransactions(input: {
  config: Config;
  owner: string;
  chainId: number;
  transactions: readonly WalletTransaction[];
  onProgress?: (progress: PlanProgress) => void;
}): Promise<PlanSubmission> {
  const { config, owner, chainId, transactions } = input;
  if (transactions.length === 0) throw new Error("transaction plan is empty");
  const account = getAccount(config);
  if (!account.address || account.address.toLowerCase() !== owner.toLowerCase()) {
    throw new Error("connected wallet does not match the plan owner");
  }
  if (account.chainId !== chainId) await switchChain(config, { chainId });
  const transactionHashes: `0x${string}`[] = [];
  const total = transactions.length;
  for (const [index, transaction] of transactions.entries()) {
    input.onProgress?.({ step: index + 1, total, description: transaction.description });
    const request = {
      chainId,
      account: account.address,
      to: transaction.to,
      data: transaction.data,
      value: toWeiBigInt(transaction.value),
    } as const;
    try {
      // Estimate immediately before every signature, after the prior receipt.
      // This catches changed allowances, balances, ranges, and deadlines before
      // the wallet is asked to submit a transaction that can no longer land.
      await estimateGas(config, request);
    } catch {
      throw new Error(`"${transaction.description}" is no longer executable. Nothing after it was submitted. Review a fresh quote.`);
    }
    const hash = await sendTransaction(config, request);
    const receipt = await waitForTransactionReceipt(config, { chainId, hash, timeout: 180_000 });
    if (receipt.status !== "success") {
      throw new Error(`"${transaction.description}" reverted onchain. Nothing after it was submitted.`);
    }
    transactionHashes.push(hash);
  }
  return { chainId, transactionHashes };
}

export function relaySucceeded(status: unknown): boolean {
  if (!status || typeof status !== "object") return false;
  const record = status as Record<string, unknown>;
  const value = String(record.status ?? record.state ?? "").toLowerCase();
  return value === "success" || value === "completed" || value === "filled";
}

function toWeiBigInt(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error("transaction value must be an integer string");
  return BigInt(value);
}
