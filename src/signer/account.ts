import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";
import type { Env } from "../config/env.js";

export function loadAccount(env: Env): PrivateKeyAccount | undefined {
  if (!env.privateKey) return undefined;
  return privateKeyToAccount(env.privateKey);
}

export function requireAccount(env: Env): PrivateKeyAccount {
  const account = loadAccount(env);
  if (!account) {
    throw new Error("UNABOT_PRIVATE_KEY is required for this command");
  }
  return account;
}

export function redactKey(_key: Hex | undefined): string {
  return "<redacted>";
}
