import { PublicKey, Transaction } from "@solana/web3.js";

export function deriveSolanaTreasury(input: { explicitAddress?: string }): PublicKey {
  if (!input.explicitAddress) throw new Error("UNABOT_SOLANA_TREASURY is not configured");
  return new PublicKey(input.explicitAddress);
}

export function mergeTransactionsWhenFits(target: Transaction, extra: Transaction, owner: PublicKey): Transaction | null {
  const candidate = new Transaction();
  candidate.feePayer = target.feePayer ?? owner;
  candidate.recentBlockhash = target.recentBlockhash ?? PublicKey.default.toBase58();
  if (target.lastValidBlockHeight !== undefined) candidate.lastValidBlockHeight = target.lastValidBlockHeight;
  candidate.add(...target.instructions, ...extra.instructions);
  try {
    return candidate.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1_232 ? candidate : null;
  } catch {
    return null;
  }
}
