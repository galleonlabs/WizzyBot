import { getAddress, isAddress, type Address, type PublicClient } from "viem";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { bpsOf } from "../core/fees.js";
import { loadEnv } from "../config/env.js";
import { TREASURY } from "../constants.js";
import { activeStableVaults, getStableCatalog, type StableCatalog, type StableVault } from "../vaults/catalog.js";
import { approveTx, assertVaultAsset, depositTx, readVaultPosition, redeemTx } from "../vaults/erc4626.js";
import { weightedBudgets, type SerializableTx } from "./allocation.js";
import { transferTx } from "../vaults/erc4626.js";

export type StableVaultAllocation = {
  vaultId: string;
  name: string;
  venue: string;
  curatorName: string;
  vault: Address;
  weightBps: number;
  amountUnits: string;
};

export type StableIndexPlan = {
  kind: "stable-index";
  chain: "base";
  chainId: 8453;
  owner: Address;
  asset: { address: Address; symbol: string; decimals: number };
  totalAmountUnits: string;
  serviceFeeBps: number;
  serviceFeeUnits: string;
  netAmountUnits: string;
  allocations: StableVaultAllocation[];
  transactions: SerializableTx[];
  createdAt: string;
};

export type StableWithdrawal = {
  vaultId: string;
  vault: Address;
  shares: string;
  estimatedAssets: string;
};

export type StableWithdrawPlan = {
  kind: "stable-withdraw";
  chain: "base";
  chainId: 8453;
  owner: Address;
  asset: { address: Address; symbol: string; decimals: number };
  estimatedAssetsUnits: string;
  serviceFeeBps: number;
  serviceFeeUnits: string;
  withdrawals: StableWithdrawal[];
  transactions: SerializableTx[];
  createdAt: string;
};

function baseClient(): PublicClient {
  const env = loadEnv();
  return createPublicClient({ chain: base, transport: http(env.rpcByChain.base) }) as PublicClient;
}

/**
 * Plans one USDC deposit across the active stable vault index: a service-fee
 * transfer to the treasury, then an approve + deposit pair per vault. Every
 * vault's underlying is re-verified onchain before the plan is returned.
 */
export async function planStableIndex(input: {
  owner: string;
  amountUnits: bigint;
  catalog?: StableCatalog;
  client?: PublicClient;
}): Promise<StableIndexPlan> {
  if (!isAddress(input.owner)) throw new Error("owner must be a valid EVM address");
  const owner = getAddress(input.owner);
  const catalog = input.catalog ?? getStableCatalog();
  const minimum = BigInt(catalog.minimumDepositUnits);
  if (input.amountUnits < minimum) {
    throw new Error(`Minimum deposit is ${formatUnitsPlain(minimum, catalog.asset.decimals)} ${catalog.asset.symbol}`);
  }
  const vaults = activeStableVaults(catalog);
  if (!vaults.length) throw new Error("No active vaults in the stable index");

  const serviceFee = bpsOf(input.amountUnits, catalog.fees.allocateBps);
  const net = input.amountUnits - serviceFee;
  if (net <= 0n) throw new Error("Deposit is too small after fees");

  const client = input.client ?? baseClient();
  await Promise.all(vaults.map((vault) => assertVaultAsset(client, vault.vault, catalog.asset.address)));

  const budgets = weightedBudgets(net, vaults.map((vault) => vault.weightBps));
  const transactions: SerializableTx[] = [];
  if (serviceFee > 0n) {
    transactions.push(transferTx(catalog.asset.address, TREASURY, serviceFee, "Service fee"));
  }
  const allocations: StableVaultAllocation[] = vaults.map((vault, index) => {
    const amount = budgets[index]!;
    transactions.push(approveTx(catalog.asset.address, vault.vault, amount, `Approve ${vault.name}`));
    transactions.push(depositTx(vault.vault, amount, owner, `Deposit into ${vault.name}`));
    return {
      vaultId: vault.id,
      name: vault.name,
      venue: vault.venue,
      curatorName: vault.curatorName,
      vault: vault.vault,
      weightBps: vault.weightBps,
      amountUnits: amount.toString(),
    };
  });

  return {
    kind: "stable-index",
    chain: "base",
    chainId: 8453,
    owner,
    asset: catalog.asset,
    totalAmountUnits: input.amountUnits.toString(),
    serviceFeeBps: catalog.fees.allocateBps,
    serviceFeeUnits: serviceFee.toString(),
    netAmountUnits: net.toString(),
    allocations,
    transactions,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Plans a proportional withdrawal: redeem the given fraction (bps) of every
 * held vault position back to the owner as USDC, then take the withdrawal fee.
 */
export async function planStableWithdraw(input: {
  owner: string;
  fractionBps?: number;
  catalog?: StableCatalog;
  client?: PublicClient;
}): Promise<StableWithdrawPlan> {
  if (!isAddress(input.owner)) throw new Error("owner must be a valid EVM address");
  const owner = getAddress(input.owner);
  const fraction = input.fractionBps ?? 10_000;
  if (!Number.isSafeInteger(fraction) || fraction <= 0 || fraction > 10_000) {
    throw new Error("fractionBps must be 1-10000");
  }
  const catalog = input.catalog ?? getStableCatalog();
  const client = input.client ?? baseClient();

  const positions = await Promise.all(
    catalog.vaults.map(async (vault) => ({ vault, position: await readVaultPosition(client, vault.vault, owner) })),
  );
  const held = positions.filter(({ position }) => position.shares > 0n);
  if (!held.length) throw new Error("No vault positions to withdraw");

  const transactions: SerializableTx[] = [];
  let estimatedAssets = 0n;
  const withdrawals: StableWithdrawal[] = held.map(({ vault, position }) => {
    const shares = (position.shares * BigInt(fraction)) / 10_000n;
    if (shares <= 0n) throw new Error(`Withdrawal fraction rounds to zero for ${vault.id}`);
    const assets = (position.assets * BigInt(fraction)) / 10_000n;
    estimatedAssets += assets;
    transactions.push(redeemTx(vault.vault, shares, owner, owner, `Withdraw from ${vault.name}`));
    return { vaultId: vault.id, vault: vault.vault, shares: shares.toString(), estimatedAssets: assets.toString() };
  });

  const serviceFee = bpsOf(estimatedAssets, catalog.fees.withdrawBps);
  if (serviceFee > 0n) {
    transactions.push(transferTx(catalog.asset.address, TREASURY, serviceFee, "Withdrawal fee"));
  }

  return {
    kind: "stable-withdraw",
    chain: "base",
    chainId: 8453,
    owner,
    asset: catalog.asset,
    estimatedAssetsUnits: estimatedAssets.toString(),
    serviceFeeBps: catalog.fees.withdrawBps,
    serviceFeeUnits: serviceFee.toString(),
    withdrawals,
    transactions,
    createdAt: new Date().toISOString(),
  };
}

/** Reads all stable index positions for one owner with current asset values. */
export async function readStablePositions(input: {
  owner: string;
  catalog?: StableCatalog;
  client?: PublicClient;
}): Promise<Array<StableVaultAllocation & { shares: string; assetsUnits: string }>> {
  if (!isAddress(input.owner)) throw new Error("owner must be a valid EVM address");
  const owner = getAddress(input.owner);
  const catalog = input.catalog ?? getStableCatalog();
  const client = input.client ?? baseClient();
  const rows = await Promise.all(catalog.vaults.map(async (vault) => {
    const position = await readVaultPosition(client, vault.vault, owner);
    return {
      vaultId: vault.id,
      name: vault.name,
      venue: vault.venue,
      curatorName: vault.curatorName,
      vault: vault.vault,
      weightBps: vault.weightBps,
      amountUnits: position.assets.toString(),
      shares: position.shares.toString(),
      assetsUnits: position.assets.toString(),
    };
  }));
  return rows.filter((row) => BigInt(row.shares) > 0n);
}

function formatUnitsPlain(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const raw = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = raw.slice(0, raw.length - decimals) || "0";
  const fraction = raw.slice(raw.length - decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
