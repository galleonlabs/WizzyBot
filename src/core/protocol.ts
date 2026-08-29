import { getAddress, type Address } from "viem";
import type { Protocol } from "../types.js";
import { ADDRESSES } from "../constants.js";

export function parseProtocol(raw?: string): Protocol {
  const v = (raw ?? "v3").trim().toLowerCase();
  if (v === "v2" || v === "2") return "V2";
  if (v === "v4" || v === "4") return "V4";
  if (v === "v3" || v === "3") return "V3";
  throw new Error("--protocol must be v2|v3|v4");
}

/** v2 tokenId is the pair address (0x… or integer). v3/v4 tokenId is the NFT id. */
export function parseTokenId(raw: string, protocol: Protocol): bigint {
  const t = raw.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) {
    return BigInt(getAddress(t));
  }
  if (/^0x[0-9a-fA-F]+$/.test(t)) return BigInt(t);
  return BigInt(t);
}

export function pairFromTokenId(tokenId: bigint): Address {
  return getAddress(`0x${tokenId.toString(16).padStart(40, "0")}`);
}

export function writeTarget(protocol: Protocol): Address {
  if (protocol === "V2") return ADDRESSES.v2Router;
  if (protocol === "V4") return ADDRESSES.v4PositionManager;
  return ADDRESSES.nfpm;
}

export function isNativeCurrency(address: Address): boolean {
  return address.toLowerCase() === ADDRESSES.nativeEth.toLowerCase();
}
