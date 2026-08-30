import BN from "bn.js";
import { StrategyType } from "@meteora-ag/dlmm";
import {
  DLMM_PROGRAM_ID,
  JUP_V6_PROGRAM_ID,
  MEMO_PROGRAM_ID,
  ZAP_PROGRAM_ID,
  Zap,
  estimateDlmmDirectSwap,
} from "@meteora-ag/zap-sdk";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { getSolanaMarketCatalog } from "./portfolio-server";
import { getSolanaConnection } from "./solana-rpc-server";

const WSOL = new PublicKey("So11111111111111111111111111111111111111112");

type SolanaMarket = {
  id: string;
  symbol: string;
  pool: string;
  rangeDelta: number;
  status: "active" | "paused" | "watch";
};

export type SolanaZapTransaction = {
  id: string;
  label: string;
  transactionBase64: string;
  requiresPositionSignature: boolean;
};

export type SolanaZapPlan = {
  kind: "solana-zap";
  owner: string;
  marketId: string;
  symbol: string;
  pool: string;
  position: string;
  amountLamports: string;
  transactions: SolanaZapTransaction[];
  createdAt: string;
  expiresAt: string;
};

export async function planSolanaZap(input: {
  owner: string;
  marketId: string;
  amountLamports: bigint;
  position: string;
}): Promise<SolanaZapPlan> {
  const owner = new PublicKey(input.owner);
  const position = new PublicKey(input.position);
  if (input.amountLamports < 20_000_000n) throw new Error("Solana market amount is below the safe zap minimum");
  const catalog = getSolanaMarketCatalog() as { markets: SolanaMarket[] };
  const market = catalog.markets.find((candidate) => candidate.id === input.marketId && candidate.status === "active");
  if (!market) throw new Error("Unknown or inactive Solana market");

  const connection = getSolanaConnection();
  const pool = new PublicKey(market.pool);
  const amountIn = new BN(input.amountLamports.toString());
  const config = {
    jupiterApiUrl: process.env.JUPITER_API_URL ?? "https://api.jup.ag",
    jupiterApiKey: process.env.JUPITER_API_KEY ?? "",
  };
  const estimate = await estimateDlmmDirectSwap({
    amountIn,
    inputTokenMint: WSOL,
    lbPair: pool,
    connection,
    swapSlippageBps: 150,
    minDeltaId: -market.rangeDelta,
    maxDeltaId: market.rangeDelta,
    strategy: StrategyType.Spot,
    config,
  });
  const zap = new Zap(connection, config);
  const params = await zap.getZapInDlmmDirectParams({
    user: owner,
    lbPair: pool,
    inputTokenMint: WSOL,
    amountIn,
    maxActiveBinSlippage: 8,
    minDeltaId: -market.rangeDelta,
    maxDeltaId: market.rangeDelta,
    strategy: StrategyType.Spot,
    favorXInActiveId: false,
    maxAccounts: 48,
    swapSlippageBps: 150,
    maxTransferAmountExtendPercentage: 2,
    directSwapEstimate: estimate.result,
  });
  const built = await zap.buildZapInDlmmTransaction({ ...params, position });
  const ordered = [
    built.setupTransaction ? { id: "setup", label: "Prepare Solana accounts", tx: built.setupTransaction } : null,
    ...built.swapTransactions.map((tx, index) => ({ id: `balance-${index + 1}`, label: "Balance the meme pair", tx })),
    { id: "ledger", label: "Record the deposit", tx: built.ledgerTransaction },
    { id: "liquidity", label: `Open ${market.symbol} liquidity`, tx: built.zapInTransaction },
    { id: "cleanup", label: "Return unused SOL", tx: built.cleanUpTransaction },
  ].filter((item): item is { id: string; label: string; tx: Transaction } => Boolean(item && item.tx.instructions.length));

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const transactions = ordered.map(({ id, label, tx }) => {
    tx.feePayer = owner;
    tx.recentBlockhash = blockhash;
    assertSafeZapTransaction(tx, owner, position);
    const requiresPositionSignature = tx.instructions.some((instruction) => instruction.keys.some((key) => key.isSigner && key.pubkey.equals(position)));
    return {
      id,
      label,
      transactionBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
      requiresPositionSignature,
    };
  });
  const now = new Date();
  return {
    kind: "solana-zap",
    owner: owner.toBase58(),
    marketId: market.id,
    symbol: market.symbol,
    pool: market.pool,
    position: position.toBase58(),
    amountLamports: input.amountLamports.toString(),
    transactions,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 90_000).toISOString(),
  };
}

function assertSafeZapTransaction(transaction: Transaction, owner: PublicKey, position: PublicKey): void {
  const allowedPrograms = new Set([
    ZAP_PROGRAM_ID.toBase58(),
    DLMM_PROGRAM_ID.toBase58(),
    JUP_V6_PROGRAM_ID.toBase58(),
    MEMO_PROGRAM_ID.toBase58(),
    SystemProgram.programId.toBase58(),
    ComputeBudgetProgram.programId.toBase58(),
    TOKEN_PROGRAM_ID.toBase58(),
    TOKEN_2022_PROGRAM_ID.toBase58(),
    ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  ]);
  for (const instruction of transaction.instructions) {
    if (!allowedPrograms.has(instruction.programId.toBase58())) {
      throw new Error("Solana allocation contains an unreviewed program");
    }
    for (const key of instruction.keys) {
      if (key.isSigner && !key.pubkey.equals(owner) && !key.pubkey.equals(position)) {
        throw new Error("Solana allocation requests an unexpected signer");
      }
    }
  }
}
