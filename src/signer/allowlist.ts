import { getAddress, type Address } from "viem";
import { SIGNER_ALLOWLIST } from "../constants.js";

export function isAllowedTarget(to: Address, extra: Address[] = []): boolean {
  const allowed = new Set(
    [...SIGNER_ALLOWLIST, ...extra].map((a) => getAddress(a).toLowerCase()),
  );
  return allowed.has(getAddress(to).toLowerCase());
}

export function assertAllowedTarget(to: Address, extra: Address[] = []): void {
  if (!isAllowedTarget(to, extra)) {
    throw new Error(
      `Refusing send to ${to}. Allowlist: NFPM, Permit2, Universal Router, treasury, plus the position tokens.`,
    );
  }
}

export function allowlistWithTokens(token0: Address, token1: Address): Address[] {
  return [...SIGNER_ALLOWLIST, token0, token1];
}
