import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { assertAllowedTarget } from "./allowlist.js";
import { viemChainFor, type ChainSlug } from "../chains.js";
import type { PlannedTx } from "../types.js";

export function makePublicClient(rpcUrl: string, chain: Chain = base) {
  return createPublicClient({
    chain,
    transport: http(rpcUrl, {
      batch: { batchSize: 20, wait: 10 },
      retryCount: 6,
      retryDelay: 500,
      timeout: 15_000,
    }),
  });
}

export function makeWalletClient(rpcUrl: string, account: Account, chain: Chain = base) {
  return createWalletClient({ account, chain, transport: http(rpcUrl) });
}

export function isPlaceholderTx(tx: PlannedTx): boolean {
  return !tx.data || tx.data === "0x" || tx.data === "0x0";
}

/** Dry-run unless live=true. Never broadcasts empty calldata or off-allowlist targets. */
export async function sendPlannedTx(args: {
  rpcUrl: string;
  account: Account;
  tx: PlannedTx;
  extraAllow: Address[];
  live?: boolean;
  chain?: ChainSlug;
}): Promise<{ hash?: Hash; dryRun: true } | { hash: Hash; dryRun: false }> {
  const chain = args.chain ?? "base";
  assertAllowedTarget(args.tx.to, args.extraAllow, chain);
  if (!args.live) {
    return { dryRun: true };
  }
  if (isPlaceholderTx(args.tx)) {
    throw new Error(`Refusing broadcast of empty calldata to ${args.tx.to} (${args.tx.description})`);
  }
  const wallet = makeWalletClient(args.rpcUrl, args.account, viemChainFor(chain));
  const hash = await wallet.sendTransaction({
    to: args.tx.to,
    data: args.tx.data as Hex,
    value: args.tx.value,
  });
  return { hash, dryRun: false };
}
