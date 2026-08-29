import BN from "bn.js";
import { StrategyType } from "@meteora-ag/dlmm";
import { Zap, estimateDlmmDirectSwap } from "@meteora-ag/zap-sdk";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { getSolanaMarketCatalog } from "./portfolio-server";

const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const DEFAULT_SOLANA_RPC = "https://api.mainnet-beta.solana.com";

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

  const connection = new Connection(process.env.SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC, "confirmed");
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
