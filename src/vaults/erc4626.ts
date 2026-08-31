import { encodeFunctionData, parseAbi, type Address, type PublicClient } from "viem";
import { erc20Abi } from "../chain/abi.js";
import type { SerializableTx } from "../portfolio/allocation.js";

export const erc4626Abi = parseAbi([
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function convertToShares(uint256 assets) view returns (uint256)",
  "function maxDeposit(address receiver) view returns (uint256)",
  "function maxRedeem(address owner) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
]);

export type VaultPosition = {
  vault: Address;
  shares: bigint;
  assets: bigint;
};

/** Reads one owner's position: raw shares plus their current asset value. */
export async function readVaultPosition(client: PublicClient, vault: Address, owner: Address): Promise<VaultPosition> {
  const shares = await client.readContract({ address: vault, abi: erc4626Abi, functionName: "balanceOf", args: [owner] });
  const assets = shares === 0n
    ? 0n
    : await client.readContract({ address: vault, abi: erc4626Abi, functionName: "convertToAssets", args: [shares] });
  return { vault, shares, assets };
}

/** Verifies the vault serves the expected underlying before any deposit is planned. */
export async function assertVaultAsset(client: PublicClient, vault: Address, expectedAsset: Address): Promise<void> {
  const asset = await client.readContract({ address: vault, abi: erc4626Abi, functionName: "asset" });
  if (asset.toLowerCase() !== expectedAsset.toLowerCase()) {
    throw new Error(`Vault ${vault} asset ${asset} does not match expected ${expectedAsset}`);
  }
}

export function approveTx(token: Address, spender: Address, amount: bigint, description: string): SerializableTx {
  return {
    to: token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
    value: "0",
    description,
  };
}

export function transferTx(token: Address, recipient: Address, amount: bigint, description: string): SerializableTx {
  return {
    to: token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, amount] }),
    value: "0",
    description,
  };
}

export function depositTx(vault: Address, assets: bigint, receiver: Address, description: string): SerializableTx {
  return {
    to: vault,
    data: encodeFunctionData({ abi: erc4626Abi, functionName: "deposit", args: [assets, receiver] }),
    value: "0",
    description,
  };
}

export function redeemTx(vault: Address, shares: bigint, receiver: Address, owner: Address, description: string): SerializableTx {
  return {
    to: vault,
    data: encodeFunctionData({ abi: erc4626Abi, functionName: "redeem", args: [shares, receiver, owner] }),
    value: "0",
    description,
  };
}
