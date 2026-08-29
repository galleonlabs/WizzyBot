import { getAddress, isAddress, type Address } from "viem";
import { addressesFor, chainOf, type ChainSlug } from "../chains.js";
import { V3Adapter } from "../chain/positions.js";
import { loadEnv } from "../config/env.js";
import { bpsOf } from "../core/fees.js";
import { chainCatalog, getMarketCatalog } from "../markets/catalog.js";
import { makePublicClient } from "../signer/broadcast.js";
import type { PlannedTx, PositionSnapshot } from "../types.js";
import {
  collectCalldata,
  decreaseCalldata,
  erc20ApproveTx,
  erc20TransferTx,
  increaseCalldata,
} from "../uniswap/calldata.js";
import type { SerializableTx } from "./allocation.js";

const PLAN_TTL_MS = 8 * 60_000;
const WITHDRAW_FEE_SAFETY_BPS = 9_800n;
const BPS = 10_000n;

export type PositionActionPlan = {
  kind: "compound" | "withdraw";
  owner: Address;
  chain: ChainSlug;
  chainId: number;
  tokenId: string;
  pair: string;
  execution: "wallet_sendCalls";
  atomic: true;
  expectedConfirmations: 1;
  serviceFeeBps: number;
  serviceFee: Array<{ token: Address; symbol: string; amount: string }>;
  transactions: SerializableTx[];
  allowedTargets: Address[];
  createdAt: string;
  expiresAt: string;
  notices: string[];
};

export async function planPositionAction(input: {
  owner: string;
  chain: ChainSlug;
  tokenId: bigint;
  action: "compound" | "withdraw";
}): Promise<PositionActionPlan> {
  if (!isAddress(input.owner)) throw new Error("owner must be a valid EVM address");
  const owner = getAddress(input.owner);
  const chain = chainOf(input.chain);
  const env = loadEnv();
  const client = makePublicClient(env.rpcByChain[input.chain], chain.viem);
  const snapshot = await new V3Adapter(client).readPosition(input.tokenId);
  if (snapshot.owner.toLowerCase() !== owner.toLowerCase()) throw new Error("wallet does not own this position");
  const configured = chainCatalog(input.chain).markets.some(
    (market) => market.pool.toLowerCase() === snapshot.pool.toLowerCase(),
  );
  if (!configured) throw new Error("position pool is not in Una's curated market catalog");
  return buildPositionActionPlan(snapshot, owner, input.chain, input.action, env.treasury);
}

export function buildPositionActionPlan(
  snapshot: PositionSnapshot,
  owner: Address,
  chain: ChainSlug,
  action: "compound" | "withdraw",
  treasury: Address,
): PositionActionPlan {
  if (snapshot.ref.protocol !== "V3") throw new Error("launch portfolio actions support Uniswap v3 positions");
  if (snapshot.ref.chainId !== chainOf(chain).id) throw new Error("position chain mismatch");
  if (snapshot.owner.toLowerCase() !== owner.toLowerCase()) throw new Error("wallet does not own this position");

  const feeBps = action === "compound"
    ? getMarketCatalog().fees.compoundBps
    : getMarketCatalog().fees.withdrawBps;
  const base0 = action === "compound"
    ? snapshot.uncollected0
    : ((snapshot.amount0 + snapshot.uncollected0) * WITHDRAW_FEE_SAFETY_BPS) / BPS;
  const base1 = action === "compound"
    ? snapshot.uncollected1
    : ((snapshot.amount1 + snapshot.uncollected1) * WITHDRAW_FEE_SAFETY_BPS) / BPS;
  const fee0 = bpsOf(base0, feeBps);
  const fee1 = bpsOf(base1, feeBps);
  const transactions = action === "compound"
    ? compoundTransactions(snapshot, owner, treasury, fee0, fee1)
    : withdrawTransactions(snapshot, owner, treasury, fee0, fee1);
  const addresses = addressesFor(chain);
  const allowedTargets = uniqueAddresses([addresses.nfpm, snapshot.token0.address, snapshot.token1.address, treasury]);
  assertAllowed(transactions, allowedTargets);

  const now = new Date();
  return {
    kind: action,
    owner,
    chain,
    chainId: snapshot.ref.chainId,
    tokenId: snapshot.ref.tokenId.toString(),
    pair: `${snapshot.token0.symbol}/${snapshot.token1.symbol}`,
    execution: "wallet_sendCalls",
    atomic: true,
    expectedConfirmations: 1,
    serviceFeeBps: feeBps,
    serviceFee: [
      { token: snapshot.token0.address, symbol: snapshot.token0.symbol, amount: fee0.toString() },
      { token: snapshot.token1.address, symbol: snapshot.token1.symbol, amount: fee1.toString() },
    ],
    transactions: transactions.map(serialize),
    allowedTargets,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PLAN_TTL_MS).toISOString(),
    notices: action === "compound"
      ? [
          "Fees are collected to your wallet, Una's disclosed fee is transferred, and the remainder is added to the same NFT.",
          "No swap is forced: any token amount that does not fit the current range ratio remains in your wallet.",
        ]
      : [
          "The full position is removed and the empty NFT is burned in the same wallet batch.",
          "You receive both underlying pool tokens. Consolidating them to ETH is a separate quoted action so no hidden swap is taken.",
          "The fee is calculated below the slippage-adjusted expected withdrawal amounts; re-plan if this quote expires.",
        ],
  };
}

function compoundTransactions(
  snapshot: PositionSnapshot,
  owner: Address,
  treasury: Address,
  fee0: bigint,
  fee1: bigint,
): PlannedTx[] {
  const add0 = snapshot.uncollected0 - fee0;
  const add1 = snapshot.uncollected1 - fee1;
  if (add0 <= 0n && add1 <= 0n) throw new Error("no uncollected fees to compound");
  const nfpm = addressesFor(snapshot.ref.chainId === 4663 ? "robinhood" : "base").nfpm;
  const txs: PlannedTx[] = [collectCalldata(snapshot, owner)];
  if (fee0 > 0n) txs.push(erc20TransferTx(snapshot.token0.address, treasury, fee0));
  if (fee1 > 0n) txs.push(erc20TransferTx(snapshot.token1.address, treasury, fee1));
  if (add0 > 0n) txs.push(erc20ApproveTx(snapshot.token0.address, nfpm, add0));
  if (add1 > 0n) txs.push(erc20ApproveTx(snapshot.token1.address, nfpm, add1));
  txs.push(increaseCalldata(snapshot, add0, add1, 150, Math.floor(PLAN_TTL_MS / 1_000)));
  return txs;
}

function withdrawTransactions(
  snapshot: PositionSnapshot,
  owner: Address,
  treasury: Address,
  fee0: bigint,
  fee1: bigint,
): PlannedTx[] {
  if (snapshot.liquidity <= 0n) throw new Error("position is already closed");
  const txs: PlannedTx[] = [
    decreaseCalldata(snapshot, 100, owner, 150, Math.floor(PLAN_TTL_MS / 1_000), true),
  ];
  if (fee0 > 0n) txs.push(erc20TransferTx(snapshot.token0.address, treasury, fee0));
  if (fee1 > 0n) txs.push(erc20TransferTx(snapshot.token1.address, treasury, fee1));
  return txs;
}

function serialize(tx: PlannedTx): SerializableTx {
  return { ...tx, value: tx.value.toString() };
}

function uniqueAddresses(addresses: readonly Address[]): Address[] {
  const unique = new Map<string, Address>();
  for (const address of addresses) unique.set(address.toLowerCase(), getAddress(address));
  return [...unique.values()];
}

function assertAllowed(transactions: readonly PlannedTx[], allowedTargets: readonly Address[]): void {
  const allowed = new Set(allowedTargets.map((address) => address.toLowerCase()));
  for (const transaction of transactions) {
    if (!allowed.has(transaction.to.toLowerCase())) throw new Error(`Refuse unapproved transaction target ${transaction.to}`);
    if (transaction.data === "0x") throw new Error(`Refuse empty transaction to ${transaction.to}`);
  }
}
