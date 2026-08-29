import BN from "bn.js";
import DLMM, { StrategyType, type LbPosition } from "@meteora-ag/dlmm";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { getMarketCatalog, getSolanaMarketCatalog } from "./portfolio-server";
import { deriveSolanaTreasury, mergeTransactionsWhenFits } from "./solana-plan-utils";

const DEFAULT_SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const BPS = 10_000n;
const ACTION_TTL_MS = 90_000;
const MEMO_PROGRAMS = [
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
];

type SolanaMarket = {
  id: string;
  symbol: string;
  token: string;
  quoteToken: string;
  quoteSymbol: "SOL";
  pool: string;
  feeBps: number;
  status: "active" | "paused" | "watch";
};

type SolanaCatalog = { markets: SolanaMarket[] };
type FeeCatalog = { fees: { compoundBps: number; withdrawBps: number } };

type PairPrice = {
  baseToken?: { address?: string };
  priceNative?: string;
  priceUsd?: string;
};

export type SolanaPositionRow = {
  kind: "live";
  protocol: "DLMM";
  chain: "solana";
  chainLabel: "Solana";
  venue: "meteora-dlmm";
  venueLabel: "Meteora";
  positionManager: string;
  tokenId: string;
  marketId: string;
  pair: string;
  fee: number;
  feeLabel: string;
  inRange: boolean;
  closed: false;
  fullRange: false;
  tickLower: number;
  tickUpper: number;
  tickCurrent: number;
  percentThroughRange: number;
  price: number;
  priceMin: number | null;
  priceMax: number | null;
  symbol0: string;
  symbol1: string;
  amount0: string;
  amount1: string;
  uncollected0: string;
  uncollected1: string;
  amount0Usd?: number;
  amount1Usd?: number;
  positionUsd?: number;
  feesUsd?: number;
  lpUsd?: number;
  pool: string;
  owner: string;
};

export type SolanaActionTransaction = {
  id: string;
  label: string;
  transactionBase64: string;
};

export type SolanaPositionActionPlan = {
  kind: "compound" | "withdraw";
  owner: string;
  chain: "solana";
  chainId: 792703809;
  tokenId: string;
  marketId: string;
  pair: string;
  expectedConfirmations: 1;
  serviceFeeBps: number;
  serviceFee: Array<{ token: string; symbol: string; amount: string }>;
  transactions: SolanaActionTransaction[];
  createdAt: string;
  expiresAt: string;
  notices: string[];
};

export async function fetchSolanaPositionList(ownerAddress: string): Promise<{
  chain: "solana";
  owner: string;
  positions: SolanaPositionRow[];
}> {
  const owner = new PublicKey(ownerAddress);
  // Retain discovery for paused/watch entries so a catalog status change never
  // hides an existing wallet position. Only active entries receive new liquidity.
  const markets = (getSolanaMarketCatalog() as SolanaCatalog).markets;
  const connection = solanaConnection();
  const pools = await DLMM.createMultiple(connection, markets.map((market) => new PublicKey(market.pool)));
  const results = await Promise.allSettled(pools.map(async (pool, index) => {
    const market = markets[index]!;
    assertCuratedPool(pool, market);
    return { index, result: await pool.getPositionsByUserAndLbPair(owner) };
  }));
  if (results.every((result) => result.status === "rejected")) {
    throw new Error("Could not read any configured Solana pools");
  }
  const prices = await Promise.all(markets.map((market) => fetchPairPrices(market)));

  const positions = results.flatMap((settled) => {
    if (settled.status === "rejected") return [];
    const { index, result } = settled.value;
    const market = markets[index]!;
    const pool = pools[index]!;
    return result.userPositions.filter(hasPositionValue).map((position) => positionRow({
      owner,
      market,
      pool,
      position,
      activeBinId: result.activeBin.binId,
      activePrice: finite(result.activeBin.pricePerToken) ?? 0,
      prices: prices[index]!,
    }));
  });

  return { chain: "solana", owner: owner.toBase58(), positions };
}

function hasPositionValue(position: LbPosition): boolean {
  const data = position.positionData;
  return !data.totalXAmountExcludeTransferFee.isZero()
    || !data.totalYAmountExcludeTransferFee.isZero()
    || !data.feeXExcludeTransferFee.isZero()
    || !data.feeYExcludeTransferFee.isZero();
}

export async function planSolanaPositionAction(input: {
  owner: string;
  marketId: string;
  position: string;
  action: "compound" | "withdraw";
}): Promise<SolanaPositionActionPlan> {
  const owner = new PublicKey(input.owner);
  const positionAddress = new PublicKey(input.position);
  const catalog = getSolanaMarketCatalog() as SolanaCatalog;
  const market = catalog.markets.find((candidate) => candidate.id === input.marketId);
  if (!market) throw new Error("Unknown Solana market");
  if (input.action === "compound" && market.status !== "active") throw new Error("This Solana market is paused; withdraw remains available");

  const connection = solanaConnection();
  const pool = await DLMM.create(connection, new PublicKey(market.pool));
  assertCuratedPool(pool, market);
  const result = await pool.getPositionsByUserAndLbPair(owner);
  const position = result.userPositions.find((candidate) => candidate.publicKey.equals(positionAddress));
  if (!position || !position.positionData.owner.equals(owner)) throw new Error("Position is not held by this Solana wallet");

  const feeCatalog = getMarketCatalog() as FeeCatalog;
  const serviceFeeBps = input.action === "compound" ? feeCatalog.fees.compoundBps : feeCatalog.fees.withdrawBps;
  const treasury = deriveSolanaTreasury({ explicitAddress: process.env.UNABOT_SOLANA_TREASURY });
  const xGross = input.action === "compound"
    ? position.positionData.feeXExcludeTransferFee
    : position.positionData.totalXAmountExcludeTransferFee.add(position.positionData.feeXExcludeTransferFee);
  const yGross = input.action === "compound"
    ? position.positionData.feeYExcludeTransferFee
    : position.positionData.totalYAmountExcludeTransferFee.add(position.positionData.feeYExcludeTransferFee);
  if (xGross.isZero() && yGross.isZero()) {
    throw new Error(input.action === "compound" ? "This position has no fees to reinvest yet" : "This position has no liquidity to withdraw");
  }
  const xFee = bpsOf(xGross, serviceFeeBps);
  const yFee = bpsOf(yGross, serviceFeeBps);
  const transactions = input.action === "withdraw"
    ? await buildWithdrawTransactions({ pool, owner, treasury, position, xFee, yFee })
    : await buildCompoundTransactions({ pool, owner, treasury, position, xGross, yGross, xFee, yFee });
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const serialized = transactions.map(({ id, label, transaction }) => {
    transaction.feePayer = owner;
    transaction.recentBlockhash = blockhash;
    assertSafeActionTransaction(transaction, owner, pool.program.programId);
    return {
      id,
      label,
      transactionBase64: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    };
  });
  if (!serialized.length) throw new Error("Solana action contains no transactions");

  const now = new Date();
  const pair = `${market.symbol}/${market.quoteSymbol}`;
  return {
    kind: input.action,
    owner: owner.toBase58(),
    chain: "solana",
    chainId: 792703809,
    tokenId: position.publicKey.toBase58(),
    marketId: market.id,
    pair,
    expectedConfirmations: 1,
    serviceFeeBps,
    serviceFee: [
      feeLine(pool.tokenX.publicKey, tokenSymbol(pool.tokenX.publicKey, market), xFee, pool.tokenX.mint.decimals),
      feeLine(pool.tokenY.publicKey, tokenSymbol(pool.tokenY.publicKey, market), yFee, pool.tokenY.mint.decimals),
    ].filter((line) => line.amount !== "0"),
    transactions: serialized,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ACTION_TTL_MS).toISOString(),
    notices: input.action === "compound"
      ? ["Claims the position fees, pays Una’s disclosed fee, and adds the remainder back to the same Meteora position."]
      : ["Removes and closes the Meteora position. You receive both pool assets directly in your Solana wallet."],
  };
}

function positionRow(input: {
  owner: PublicKey;
  market: SolanaMarket;
  pool: DLMM;
  position: LbPosition;
  activeBinId: number;
  activePrice: number;
  prices: { memeUsd: number | null; solUsd: number | null };
}): SolanaPositionRow {
  const { market, pool, position } = input;
  const data = position.positionData;
  const xDecimals = pool.tokenX.mint.decimals;
  const yDecimals = pool.tokenY.mint.decimals;
  const xAmount = uiAmount(data.totalXAmount, xDecimals);
  const yAmount = uiAmount(data.totalYAmount, yDecimals);
  const xFees = uiAmount(data.feeX.toString(), xDecimals);
  const yFees = uiAmount(data.feeY.toString(), yDecimals);
  const xSymbol = tokenSymbol(pool.tokenX.publicKey, market);
  const ySymbol = tokenSymbol(pool.tokenY.publicKey, market);
  const xUsd = tokenUsd(pool.tokenX.publicKey, market, input.prices);
  const yUsd = tokenUsd(pool.tokenY.publicKey, market, input.prices);
  const amount0Usd = xUsd === null ? undefined : xAmount * xUsd;
  const amount1Usd = yUsd === null ? undefined : yAmount * yUsd;
  const feesUsd = xUsd === null || yUsd === null ? undefined : xFees * xUsd + yFees * yUsd;
  const positionUsd = amount0Usd === undefined || amount1Usd === undefined ? undefined : amount0Usd + amount1Usd;
  const inRange = input.activeBinId >= data.lowerBinId && input.activeBinId <= data.upperBinId;
  const width = Math.max(1, data.upperBinId - data.lowerBinId);
  const priceMin = finite(data.positionBinData[0]?.pricePerToken);
  const priceMax = finite(data.positionBinData.at(-1)?.pricePerToken);
  return {
    kind: "live",
    protocol: "DLMM",
    chain: "solana",
    chainLabel: "Solana",
    venue: "meteora-dlmm",
    venueLabel: "Meteora",
    positionManager: market.pool,
    tokenId: position.publicKey.toBase58(),
    marketId: market.id,
    pair: `${market.symbol}/${market.quoteSymbol}`,
    fee: market.feeBps * 100,
    feeLabel: `${(market.feeBps / 100).toFixed(2)}%`,
    inRange,
    closed: false,
    fullRange: false,
    tickLower: data.lowerBinId,
    tickUpper: data.upperBinId,
    tickCurrent: input.activeBinId,
    percentThroughRange: Math.max(0, Math.min(100, ((input.activeBinId - data.lowerBinId) / width) * 100)),
    price: input.activePrice,
    priceMin,
    priceMax,
    symbol0: xSymbol,
    symbol1: ySymbol,
    amount0: formatUiAmount(data.totalXAmount, xDecimals),
    amount1: formatUiAmount(data.totalYAmount, yDecimals),
    uncollected0: formatUiAmount(data.feeX.toString(), xDecimals),
    uncollected1: formatUiAmount(data.feeY.toString(), yDecimals),
    amount0Usd,
    amount1Usd,
    positionUsd,
    feesUsd,
    lpUsd: positionUsd === undefined ? undefined : positionUsd + (feesUsd ?? 0),
    pool: market.pool,
    owner: input.owner.toBase58(),
  };
}

async function buildWithdrawTransactions(input: {
  pool: DLMM;
  owner: PublicKey;
  treasury: PublicKey;
  position: LbPosition;
  xFee: BN;
  yFee: BN;
}): Promise<Array<{ id: string; label: string; transaction: Transaction }>> {
  const remove = await input.pool.removeLiquidity({
    user: input.owner,
    position: input.position.publicKey,
    fromBinId: input.position.positionData.lowerBinId,
    toBinId: input.position.positionData.upperBinId,
    bps: new BN(10_000),
    shouldClaimAndClose: true,
    skipUnwrapSOL: false,
  });
  const fee = feeTransaction(input);
  const steps = remove.map((transaction, index) => ({ id: `withdraw-${index + 1}`, label: "Withdraw Meteora liquidity", transaction }));
  if (!fee || !steps.length) return steps;
  const last = steps.at(-1)!;
  const merged = mergeTransactionsWhenFits(last.transaction, fee, input.owner);
  if (merged) {
    last.transaction = merged;
    last.label = "Withdraw liquidity and pay the disclosed Una fee";
    return steps;
  }
  return [...steps, { id: "service-fee", label: "Pay the disclosed Una fee", transaction: fee }];
}

async function buildCompoundTransactions(input: {
  pool: DLMM;
  owner: PublicKey;
  treasury: PublicKey;
  position: LbPosition;
  xGross: BN;
  yGross: BN;
  xFee: BN;
  yFee: BN;
}): Promise<Array<{ id: string; label: string; transaction: Transaction }>> {
  const claims = await input.pool.claimSwapFee({ owner: input.owner, position: input.position });
  const fee = feeTransaction(input);
  const xNet = input.xGross.sub(input.xFee);
  const yNet = input.yGross.sub(input.yFee);
  const add = await input.pool.addLiquidityByStrategy({
    positionPubKey: input.position.publicKey,
    totalXAmount: xNet,
    totalYAmount: yNet,
    strategy: {
      minBinId: input.position.positionData.lowerBinId,
      maxBinId: input.position.positionData.upperBinId,
      strategyType: StrategyType.Spot,
      ...(yNet.isZero() && !xNet.isZero() ? { singleSidedX: true } : {}),
    },
    user: input.owner,
    slippage: 1,
  });
  const steps = claims.map((transaction, index) => ({ id: `claim-${index + 1}`, label: "Collect Meteora fees", transaction }));
  if (fee && steps.length) {
    const last = steps.at(-1)!;
    const merged = mergeTransactionsWhenFits(last.transaction, fee, input.owner);
    if (merged) {
      last.transaction = merged;
      last.label = "Collect fees and pay the disclosed Una fee";
    } else {
      steps.push({ id: "service-fee", label: "Pay the disclosed Una fee", transaction: fee });
    }
  }
  return [...steps, { id: "reinvest", label: "Reinvest fees in the same position", transaction: add }];
}

function feeTransaction(input: {
  pool: DLMM;
  owner: PublicKey;
  treasury: PublicKey;
  xFee: BN;
  yFee: BN;
}): Transaction | null {
  const transaction = new Transaction();
  const fees = [
    { reserve: input.pool.tokenX, amount: input.xFee },
    { reserve: input.pool.tokenY, amount: input.yFee },
  ];
  const tokenFee = fees.find(({ reserve }) => !reserve.publicKey.equals(NATIVE_MINT));
  if (!tokenFee) throw new Error("A Meteora fee pair must include a non-native token");
  const lamportRecipient = getAssociatedTokenAddressSync(
    tokenFee.reserve.publicKey,
    input.treasury,
    false,
    tokenFee.reserve.owner,
  );
  for (const fee of fees.filter(({ reserve }) => !reserve.publicKey.equals(NATIVE_MINT))) {
    appendTokenFeeTransfer(transaction, input.owner, input.treasury, fee.reserve, fee.amount);
  }
  const nativeFee = fees.find(({ reserve }) => reserve.publicKey.equals(NATIVE_MINT));
  if (nativeFee && !nativeFee.amount.isZero()) {
    // The token fee transfer normally creates this account first. When a
    // position is entirely SOL-sided, create it explicitly. Sending lamports
    // to the initialized token account avoids the rent floor for a new system
    // account while keeping the fee recoverable by the treasury authority.
    if (tokenFee.amount.isZero()) {
      transaction.add(createAssociatedTokenAccountIdempotentInstruction(
        input.owner,
        lamportRecipient,
        input.treasury,
        tokenFee.reserve.publicKey,
        tokenFee.reserve.owner,
      ));
    }
    transaction.add(SystemProgram.transfer({
      fromPubkey: input.owner,
      toPubkey: lamportRecipient,
      lamports: BigInt(nativeFee.amount.toString()),
    }));
  }
  return transaction.instructions.length ? transaction : null;
}

function appendTokenFeeTransfer(
  transaction: Transaction,
  owner: PublicKey,
  treasury: PublicKey,
  reserve: DLMM["tokenX"],
  amount: BN,
): void {
  if (amount.isZero()) return;
  if (reserve.publicKey.equals(NATIVE_MINT)) throw new Error("Native SOL fees require a token fee account");
  if (!reserve.owner.equals(TOKEN_PROGRAM_ID) && !reserve.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error("Unsupported Solana token program");
  }
  const ownerToken = getAssociatedTokenAddressSync(reserve.publicKey, owner, false, reserve.owner);
  const treasuryToken = getAssociatedTokenAddressSync(reserve.publicKey, treasury, false, reserve.owner);
  transaction.add(
    createAssociatedTokenAccountIdempotentInstruction(owner, treasuryToken, treasury, reserve.publicKey, reserve.owner),
    createTransferCheckedInstruction(
      ownerToken,
      reserve.publicKey,
      treasuryToken,
      owner,
      BigInt(amount.toString()),
      reserve.mint.decimals,
      [],
      reserve.owner,
    ),
  );
}

function assertCuratedPool(pool: DLMM, market: SolanaMarket): void {
  const mints = new Set([pool.tokenX.publicKey.toBase58(), pool.tokenY.publicKey.toBase58()]);
  if (pool.pubkey.toBase58() !== market.pool || !mints.has(market.token) || !mints.has(market.quoteToken)) {
    throw new Error(`Curated Solana pool mismatch for ${market.id}`);
  }
}

function assertSafeActionTransaction(transaction: Transaction, owner: PublicKey, dlmmProgram: PublicKey): void {
  const allowedPrograms = new Set([
    dlmmProgram.toBase58(),
    SystemProgram.programId.toBase58(),
    ComputeBudgetProgram.programId.toBase58(),
    TOKEN_PROGRAM_ID.toBase58(),
    TOKEN_2022_PROGRAM_ID.toBase58(),
    ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    ...MEMO_PROGRAMS,
  ]);
  for (const instruction of transaction.instructions) {
    if (!allowedPrograms.has(instruction.programId.toBase58())) throw new Error("Solana action contains an unreviewed program");
    for (const key of instruction.keys) {
      if (key.isSigner && !key.pubkey.equals(owner)) throw new Error("Solana action requests an unexpected signer");
    }
  }
}

function feeLine(token: PublicKey, symbol: string, amount: BN, decimals: number) {
  return { token: token.toBase58(), symbol, amount: formatUiAmount(amount.toString(), decimals) };
}

function bpsOf(amount: BN, bps: number): BN {
  return new BN((BigInt(amount.toString()) * BigInt(bps) / BPS).toString());
}

function tokenSymbol(token: PublicKey, market: SolanaMarket): string {
  return token.toBase58() === market.token ? market.symbol : market.quoteSymbol;
}

function tokenUsd(token: PublicKey, market: SolanaMarket, prices: { memeUsd: number | null; solUsd: number | null }): number | null {
  return token.toBase58() === market.token ? prices.memeUsd : prices.solUsd;
}

async function fetchPairPrices(market: SolanaMarket): Promise<{ memeUsd: number | null; solUsd: number | null }> {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${market.pool}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return { memeUsd: null, solUsd: null };
    const payload = await response.json() as { pair?: PairPrice; pairs?: PairPrice[] };
    const pair = payload.pair ?? payload.pairs?.[0];
    const priceUsd = finite(pair?.priceUsd);
    const priceNative = finite(pair?.priceNative);
    if (priceUsd === null) return { memeUsd: null, solUsd: null };
    if (pair?.baseToken?.address === market.token) {
      return { memeUsd: priceUsd, solUsd: priceNative && priceNative > 0 ? priceUsd / priceNative : null };
    }
    if (pair?.baseToken?.address === market.quoteToken) {
      return { memeUsd: priceNative && priceNative > 0 ? priceUsd / priceNative : null, solUsd: priceUsd };
    }
    return { memeUsd: null, solUsd: null };
  } catch {
    return { memeUsd: null, solUsd: null };
  }
}

function uiAmount(raw: string, decimals: number): number {
  const value = Number(raw) / 10 ** decimals;
  return Number.isFinite(value) ? value : 0;
}

function formatUiAmount(raw: string, decimals: number): string {
  const negative = raw.startsWith("-");
  const digits = (negative ? raw.slice(1) : raw).split(".")[0]!.replace(/^0+(?=\d)/, "") || "0";
  if (decimals === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function solanaConnection(): Connection {
  return new Connection(process.env.SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC, "confirmed");
}
