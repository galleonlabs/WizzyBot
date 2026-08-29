import { getAddress, isAddress, type Account, type Address, type Hex } from "viem";
import { PrivyClient } from "@privy-io/server-auth";
import type { PlannedTx } from "../types.js";
import { assertAllowedTarget } from "./allowlist.js";
import { makePublicClient } from "./broadcast.js";
import { CHAIN_ID } from "../constants.js";

/** Public Privy app id. Safe to ship. Secret stays in env. */
export const DEFAULT_PRIVY_APP_ID = "cmteeqkjc03e20cjl59c9kbwu";

export const PRIVY_STUB_MESSAGE =
  "Privy live signing is stubbed until PRIVY_APP_SECRET is set. Also set NEXT_PUBLIC_PRIVY_APP_ID or PRIVY_APP_ID (defaults to the public app id) and optionally PRIVY_WALLET_ID plus PRIVY_AUTHORIZATION_KEY.";

export type PrivyEnv = {
  appId: string;
  appSecret: string | undefined;
  authorizationKey: string | undefined;
  walletId: string | undefined;
};

export type HostedWallet = {
  walletId: string;
  address: Address;
  source: "env" | "created" | "user";
};

export function loadPrivyEnv(source: NodeJS.ProcessEnv = process.env): PrivyEnv {
  const appId =
    source.PRIVY_APP_ID?.trim() ||
    source.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ||
    DEFAULT_PRIVY_APP_ID;
  return {
    appId,
    appSecret: source.PRIVY_APP_SECRET?.trim() || undefined,
    authorizationKey: source.PRIVY_AUTHORIZATION_KEY?.trim() || undefined,
    walletId: source.PRIVY_WALLET_ID?.trim() || undefined,
  };
}

export function privyConfigured(env: PrivyEnv = loadPrivyEnv()): boolean {
  return Boolean(env.appId && env.appSecret);
}

export function createPrivyClient(env: PrivyEnv = loadPrivyEnv()): PrivyClient | null {
  if (!env.appSecret) return null;
  return new PrivyClient(env.appId, env.appSecret, {
    walletApi: env.authorizationKey
      ? { authorizationPrivateKey: env.authorizationKey }
      : undefined,
  });
}

export function requirePrivyClient(env: PrivyEnv = loadPrivyEnv()): PrivyClient {
  const client = createPrivyClient(env);
  if (!client) throw new Error(PRIVY_STUB_MESSAGE);
  return client;
}

export async function resolveHostedWallet(
  env: PrivyEnv = loadPrivyEnv(),
): Promise<HostedWallet> {
  const client = requirePrivyClient(env);
  if (env.walletId) {
    const wallet = await client.walletApi.getWallet({ id: env.walletId });
    return {
      walletId: wallet.id,
      address: getAddress(wallet.address),
      source: "env",
    };
  }
  const created = await client.walletApi.createWallet({ chainType: "ethereum" });
  return {
    walletId: created.id,
    address: getAddress(created.address),
    source: "created",
  };
}

export async function resolveUserWallet(input: {
  userJwt?: string;
  userId?: string;
}): Promise<HostedWallet> {
  const client = requirePrivyClient();
  const user = input.userJwt
    ? await client.getUser({ idToken: input.userJwt })
    : input.userId
      ? await client.getUser(input.userId)
      : undefined;
  if (!user) throw new Error("Pass userJwt or userId to resolve a Privy user wallet.");
  const linked = user.linkedAccounts.find(
    (account) =>
      account.type === "wallet" &&
      "address" in account &&
      typeof account.address === "string" &&
      isAddress(account.address) &&
      (!("chainType" in account) || account.chainType === "ethereum"),
  );
  if (!linked || !("address" in linked)) {
    throw new Error(`No Ethereum wallet linked for Privy user ${user.id}`);
  }
  const walletId =
    "id" in linked && typeof linked.id === "string" ? linked.id : user.id;
  return { walletId, address: getAddress(linked.address), source: "user" };
}

export async function getPrivyAccount(wallet?: HostedWallet): Promise<Account> {
  const env = loadPrivyEnv();
  const resolved = wallet ?? (await resolveHostedWallet(env));
  const { createViemAccount } = await import("@privy-io/server-auth/viem");
  return createViemAccount({
    walletId: resolved.walletId,
    address: resolved.address,
    privy: requirePrivyClient(env) as never,
  });
}

export async function sendWithPrivy(args: {
  rpcUrl: string;
  tx: PlannedTx;
  extraAllow: Address[];
  live: boolean;
  wallet?: HostedWallet;
}): Promise<{ hash?: Hex; dryRun: boolean; stubbed?: boolean }> {
  assertAllowedTarget(args.tx.to, args.extraAllow);
  if (!args.live) return { dryRun: true };
  if (!privyConfigured()) {
    return { dryRun: true, stubbed: true };
  }
  const wallet = args.wallet ?? (await resolveHostedWallet());
  const signed = await requirePrivyClient().walletApi.ethereum.signTransaction({
    walletId: wallet.walletId,
    transaction: {
      to: args.tx.to,
      data: args.tx.data,
      value: `0x${args.tx.value.toString(16)}`,
      chainId: CHAIN_ID,
    },
  });
  const client = makePublicClient(args.rpcUrl);
  const hash = await client.sendRawTransaction({
    serializedTransaction: signed.signedTransaction as Hex,
  });
  return { hash, dryRun: false };
}
