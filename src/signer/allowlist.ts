import { getAddress, type Address } from "viem";
import type { ChainSlug } from "../chains.js";
import { signerAllowlistFor } from "../chains.js";

export function isAllowedTarget(to: Address, extra: Address[] = [], chain: ChainSlug = "base"): boolean {
  const allowed = new Set(
    [...signerAllowlistFor(chain), ...extra].map((a) => getAddress(a).toLowerCase()),
  );
  return allowed.has(getAddress(to).toLowerCase());
}

export function assertAllowedTarget(to: Address, extra: Address[] = [], chain: ChainSlug = "base"): void {
  if (!isAllowedTarget(to, extra, chain)) {
    throw new Error(
      `Refusing send to ${to}. Allowlist: NFPM, Permit2, Universal Router, plus the position tokens.`,
    );
  }
}

export function allowlistWithTokens(token0: Address, token1: Address, chain: ChainSlug = "base"): Address[] {
  return [...signerAllowlistFor(chain), token0, token1];
}
