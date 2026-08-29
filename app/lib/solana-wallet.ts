import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { useSignTransaction, type ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import type { SolanaZapPlan } from "./solana-zap-server";

export type SolanaExecutionProgress = {
  market: string;
  step: number;
  total: number;
  label: string;
};

type SignTransaction = ReturnType<typeof useSignTransaction>["signTransaction"];
const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");

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
    const signature = await connection.sendRawTransaction(result.signedTransaction, { maxRetries: 3, skipPreflight: false });
    signatures.push(signature);
    await waitForSolanaConfirmation(signature);
  }
  return signatures;
}

function decodeBase64(value: string): Uint8Array {
  const decoded = window.atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function waitForSolanaConfirmation(signature: string): Promise<void> {
  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline) {
    const response = await fetch(`/api/portfolio/solana/status?signature=${encodeURIComponent(signature)}`, { cache: "no-store" });
    const payload = await response.json() as { status?: "pending" | "confirmed" | "failed"; error?: string };
    if (payload.status === "confirmed") return;
    if (payload.status === "failed") throw new Error(payload.error ?? "A Solana liquidity transaction failed");
    await new Promise((resolve) => window.setTimeout(resolve, 1_200));
  }
  throw new Error("Solana confirmation timed out. Check the wallet before retrying.");
}
