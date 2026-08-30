import { getAddress, isAddress, type Address, type PublicClient } from "viem";
import { addressesFor, chainOf } from "../chains.js";
import { quoterV2Abi } from "../chain/abi.js";
import { V3Adapter } from "../chain/positions.js";
import { loadEnv } from "../config/env.js";
import { type CuratedMarket } from "../markets/catalog.js";
import { getRobinhoodIndexState } from "../index/registry.js";
import { makePublicClient } from "../signer/broadcast.js";
import type { PlannedTx, PositionSnapshot } from "../types.js";
import { decreaseCalldata, erc20ApproveTx, unwrapEthTx } from "../uniswap/calldata.js";
import { exactInV3Tx } from "../uniswap/router.js";
import { planAllocation, type SerializableTx } from "./allocation.js";

const BPS = 10_000n;
const PROCEEDS_SAFETY_BPS = 9_850n;
const SWAP_SLIPPAGE_BPS = 150n;
const GAS_RESERVE_WEI = 100_000_000_000_000n;
const PLAN_TTL_MS = 8 * 60_000;

export type IndexMigrationPlan = {
  kind: "index-migration";
  owner: Address;
  chain: "robinhood";
  chainId: 4663;
  migrationId: string;
  indexVersion: number;
  tokenId: string;
  fromMarket: { id: string; symbol: string };
  toMarket: { id: string; symbol: string };
  migratedAmountFloorWei: string;
  serviceFeeBps: number;
  serviceFeeWei: string;
  expectedConfirmations: 1;
  execution: "wallet_sendCalls";
  atomic: true;
  transactions: SerializableTx[];
  allowedTargets: Address[];
  createdAt: string;
  expiresAt: string;
  notices: string[];
};

export async function planIndexMigration(input: {
  owner: string;
  tokenId: bigint;
  migrationId: string;
}): Promise<IndexMigrationPlan> {
  if (!isAddress(input.owner)) throw new Error("owner must be a valid EVM address");
  const owner = getAddress(input.owner);
  const indexState = await getRobinhoodIndexState();
  const catalog = indexState.catalog;
  const migration = catalog.migrations.find((candidate) => candidate.id === input.migrationId);
  if (!migration) throw new Error("This index update is no longer available");
  if (Date.parse(migration.effectiveAt) > Date.now()) throw new Error("This index update is not active yet");
  const robinhood = catalog.chains.find((chain) => chain.slug === "robinhood");
  if (!robinhood) throw new Error("The Robinhood index catalog is unavailable");
  const fromMarket = robinhood.markets.find((market) => market.id === migration.fromMarketId);
  const toMarket = robinhood.markets.find((market) => market.id === migration.toMarketId);
  if (!fromMarket || !toMarket || fromMarket.status === "active" || toMarket.status !== "active") {
    throw new Error("This index update does not match the live catalog");
  }
  if (fromMarket.protocol !== "V3" || toMarket.protocol !== "V3") throw new Error("Index updates currently support Uniswap v3 positions");

  const env = loadEnv();
  const chain = chainOf("robinhood");
  const client = makePublicClient(env.rpcByChain.robinhood, chain.viem);
  const snapshot = await new V3Adapter(client).readPosition(input.tokenId);
  validatePosition(snapshot, owner, fromMarket);
  const migrationTransactions = await buildMigrationTransactions(client, snapshot, owner, fromMarket);
  const allocatable = migrationTransactions.proceedsFloor - GAS_RESERVE_WEI;
  if (allocatable <= 0n) throw new Error("This position is too small to update after the Robinhood gas reserve");
  const allocation = await planAllocation({
    owner,
    chain: "robinhood",
    amountWei: allocatable,
    markets: [toMarket],
    serviceFeeBps: catalog.fees.rebalanceBps,
  });
  const transactions: PlannedTx[] = [
    migrationTransactions.decrease,
    ...migrationTransactions.swapTransactions,
    unwrapEthTx(migrationTransactions.proceedsFloor, 4663),
    ...allocation.transactions.map(deserialize),
  ];
  const allowedTargets = uniqueAddresses([
    addressesFor("robinhood").nfpm,
    addressesFor("robinhood").weth,
    addressesFor("robinhood").swapRouter02,
    fromMarket.token,
    ...allocation.allowedTargets,
  ]);
  assertAllowed(transactions, allowedTargets);
  const now = new Date();
  return {
    kind: "index-migration",
    owner,
    chain: "robinhood",
    chainId: 4663,
    migrationId: migration.id,
    indexVersion: catalog.version,
    tokenId: input.tokenId.toString(),
    fromMarket: { id: fromMarket.id, symbol: fromMarket.symbol },
    toMarket: { id: toMarket.id, symbol: toMarket.symbol },
    migratedAmountFloorWei: allocatable.toString(),
    serviceFeeBps: catalog.fees.rebalanceBps,
    serviceFeeWei: allocation.serviceFeeWei,
    expectedConfirmations: 1,
    execution: "wallet_sendCalls",
    atomic: true,
    transactions: transactions.map(serialize),
    allowedTargets,
    createdAt: now.toISOString(),
    expiresAt: new Date(Math.min(Date.parse(allocation.expiresAt), now.getTime() + PLAN_TTL_MS)).toISOString(),
    notices: [
      `Your ${fromMarket.symbol} position closes and its conservative proceeds open ${toMarket.symbol} in one atomic wallet batch.`,
      "Every unrelated index position stays untouched.",
      "Wizzy charges the disclosed rebalance fee once. Unclaimed fees and execution surplus remain in your wallet.",
      "If any call fails, the entire update reverts and the original position remains yours.",
    ],
  };
}

async function buildMigrationTransactions(
  client: PublicClient,
  snapshot: PositionSnapshot,
  owner: Address,
  fromMarket: CuratedMarket,
): Promise<{ decrease: PlannedTx; swapTransactions: PlannedTx[]; proceedsFloor: bigint }> {
  const quoteIsToken0 = snapshot.token0.address.toLowerCase() === fromMarket.quoteToken.toLowerCase();
  const wethFloor = ((quoteIsToken0 ? snapshot.amount0 : snapshot.amount1) * PROCEEDS_SAFETY_BPS) / BPS;
  const memeFloor = ((quoteIsToken0 ? snapshot.amount1 : snapshot.amount0) * PROCEEDS_SAFETY_BPS) / BPS;
  const decrease = decreaseCalldata(snapshot, 100, owner, Number(BPS - PROCEEDS_SAFETY_BPS), Math.floor(PLAN_TTL_MS / 1_000), true);
  if (memeFloor <= 0n) {
    if (wethFloor <= 0n) throw new Error("This position has no liquidity to update");
    return { decrease, swapTransactions: [], proceedsFloor: wethFloor };
  }
  const result = await client.simulateContract({
    address: addressesFor("robinhood").quoterV2,
    abi: quoterV2Abi,
    functionName: "quoteExactInputSingle",
    args: [{
      tokenIn: fromMarket.token,
      tokenOut: fromMarket.quoteToken,
      amountIn: memeFloor,
      fee: fromMarket.fee,
      sqrtPriceLimitX96: 0n,
    }],
  });
  const minimumWethOut = (result.result[0] * (BPS - SWAP_SLIPPAGE_BPS)) / BPS;
  if (minimumWethOut <= 0n) throw new Error("The outgoing market returned no usable migration quote");
  const addresses = addressesFor("robinhood");
  return {
    decrease,
    swapTransactions: [
      erc20ApproveTx(fromMarket.token, addresses.swapRouter02, memeFloor),
      exactInV3Tx({
        tokenIn: fromMarket.token,
        tokenOut: fromMarket.quoteToken,
        fee: fromMarket.fee,
        amountIn: memeFloor,
        amountOutMin: minimumWethOut,
        recipient: owner,
        payerIsUser: true,
        deadlineSec: Math.floor(PLAN_TTL_MS / 1_000),
        chainId: 4663,
      }),
    ],
    proceedsFloor: wethFloor + minimumWethOut,
  };
}

function validatePosition(snapshot: PositionSnapshot, owner: Address, market: CuratedMarket): void {
  if (snapshot.owner.toLowerCase() !== owner.toLowerCase()) throw new Error("wallet does not own this position");
  if (snapshot.ref.chainId !== 4663 || snapshot.ref.protocol !== "V3") throw new Error("position is not a Robinhood Uniswap v3 position");
  if (snapshot.pool.toLowerCase() !== market.pool.toLowerCase()) throw new Error("position does not belong to the outgoing index market");
  const tokens = new Set([snapshot.token0.address.toLowerCase(), snapshot.token1.address.toLowerCase()]);
  if (!tokens.has(market.token.toLowerCase()) || !tokens.has(market.quoteToken.toLowerCase())) throw new Error("position tokens do not match the catalog migration");
  if (snapshot.liquidity <= 0n) throw new Error("position is already closed");
}

function serialize(transaction: PlannedTx): SerializableTx {
  return { ...transaction, value: transaction.value.toString() };
}

function deserialize(transaction: SerializableTx): PlannedTx {
  return { ...transaction, value: BigInt(transaction.value) };
}

function uniqueAddresses(addresses: readonly Address[]): Address[] {
  const unique = new Map<string, Address>();
  for (const address of addresses) unique.set(address.toLowerCase(), getAddress(address));
  return [...unique.values()];
}

function assertAllowed(transactions: readonly PlannedTx[], allowedTargets: readonly Address[]): void {
  const allowed = new Set(allowedTargets.map((address) => address.toLowerCase()));
  for (const transaction of transactions) {
    if (!allowed.has(transaction.to.toLowerCase())) throw new Error(`Refuse unapproved migration target ${transaction.to}`);
    if (transaction.data === "0x" && transaction.value === 0n) throw new Error(`Refuse empty migration transaction to ${transaction.to}`);
  }
}
