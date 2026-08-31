import { Keypair, Transaction } from "@solana/web3.js";
import { useSignTransaction, type ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import type { SolanaPositionActionPlan } from "./solana-position-server";
import type { SolanaZapPlan } from "./solana-zap-server";
import { readJsonPayload } from "./api-payload";

export type SolanaExecutionProgress = {
  market: string;
  step: number;
  total: number;
  label: string;
};

type SignTransaction = ReturnType<typeof useSignTransaction>["signTransaction"];

/**
 * Collects every Meteora transaction into one Privy signing request, then broadcasts
 * the signed transactions sequentially so dependent setup and liquidity calls land in order.
 */
export async function executeSolanaZaps(input: {
  zaps: Array<{ plan: SolanaZapPlan; position: Keypair }>;
  wallet: ConnectedStandardSolanaWallet;
  signTransaction: SignTransaction;
  onProgress?: (progress: SolanaExecutionProgress) => void;
}): Promise<string[]> {
  const prepared = input.zaps.flatMap(({ plan, position }) => {
    if (plan.owner !== input.wallet.address) throw new Error("Solana wallet does not match the liquidity plan");
    if (plan.position !== position.publicKey.toBase58()) throw new Error("Solana position signer does not match the plan");
    if (Date.now() >= Date.parse(plan.expiresAt)) throw new Error("Solana liquidity quote expired");
    return plan.transactions.map((planned) => {
      const transaction = Transaction.from(decodeBase64(planned.transactionBase64));
      if (planned.requiresPositionSignature) transaction.partialSign(position);
      return {
        market: plan.symbol,
        label: planned.label,
        transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
      };
    });
  });
  if (!prepared.length) throw new Error("Solana liquidity plan contains no transactions");

  input.onProgress?.({ market: "Solana", step: 0, total: prepared.length, label: "Approve every Solana market" });
  const signed = await input.signTransaction(...prepared.map(({ transaction }) => ({
    transaction,
    wallet: input.wallet,
    chain: "solana:mainnet" as const,
  })));
  const signedTransactions = Array.isArray(signed) ? signed : [signed];
  if (signedTransactions.length !== prepared.length) throw new Error("Privy returned an incomplete Solana signing batch");

  const signatures: string[] = [];
  for (const [index, result] of signedTransactions.entries()) {
    const item = prepared[index]!;
    input.onProgress?.({ market: item.market, step: index + 1, total: prepared.length, label: item.label });
    const signature = await broadcastSignedTransaction(input.wallet.address, result.signedTransaction);
    signatures.push(signature);
    await waitForSolanaConfirmation(signature);
  }
  return signatures;
}

export async function executeSolanaPositionAction(input: {
  plan: SolanaPositionActionPlan;
  wallet: ConnectedStandardSolanaWallet;
  signTransaction: SignTransaction;
  onProgress?: (progress: SolanaExecutionProgress) => void;
}): Promise<string[]> {
  if (input.plan.owner !== input.wallet.address) throw new Error("Solana wallet does not hold this position");
  if (Date.now() >= Date.parse(input.plan.expiresAt)) throw new Error("Solana position quote expired");
  if (!input.plan.transactions.length) throw new Error("Solana position plan contains no transactions");
  const prepared = input.plan.transactions.map((planned) => ({
    market: input.plan.pair,
    label: planned.label,
    transaction: Transaction.from(decodeBase64(planned.transactionBase64)).serialize({ requireAllSignatures: false, verifySignatures: false }),
  }));
  input.onProgress?.({ market: input.plan.pair, step: 0, total: prepared.length, label: "Approve the position update" });
  const signed = await input.signTransaction(...prepared.map(({ transaction }) => ({
    transaction,
    wallet: input.wallet,
    chain: "solana:mainnet" as const,
  })));
  const signedTransactions = Array.isArray(signed) ? signed : [signed];
  if (signedTransactions.length !== prepared.length) throw new Error("Privy returned an incomplete Solana signing batch");

  const signatures: string[] = [];
  for (const [index, result] of signedTransactions.entries()) {
    const item = prepared[index]!;
    input.onProgress?.({ market: item.market, step: index + 1, total: prepared.length, label: item.label });
    const signature = await broadcastSignedTransaction(input.wallet.address, result.signedTransaction);
    signatures.push(signature);
    await waitForSolanaConfirmation(signature);
  }
  return signatures;
}

function decodeBase64(value: string): Uint8Array {
  const decoded = window.atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function encodeBase64(value: Uint8Array): string {
  return window.btoa(String.fromCharCode(...value));
}

async function broadcastSignedTransaction(owner: string, transaction: Uint8Array): Promise<string> {
  const response = await fetch("/api/portfolio/solana/broadcast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner, transactionBase64: encodeBase64(transaction) }),
  });
  const payload = await readJsonPayload(response) as { signature?: string; error?: string };
  if (!response.ok || !payload.signature) throw new Error(payload.error ?? "Could not submit Solana transaction");
  return payload.signature;
}

async function waitForSolanaConfirmation(signature: string): Promise<void> {
  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline) {
    const response = await fetch(`/api/portfolio/solana/status?signature=${encodeURIComponent(signature)}`, { cache: "no-store" });
    const payload = await readJsonPayload(response) as { status?: "pending" | "confirmed" | "failed"; error?: string };
    if (payload.status === "confirmed") return;
    if (payload.status === "failed") throw new Error(payload.error ?? "A Solana liquidity transaction failed");
    await new Promise((resolve) => window.setTimeout(resolve, 1_200));
  }
  throw new Error("Solana confirmation timed out. Check the wallet before retrying.");
}
