import { decodeFunctionData } from "viem";
import { describe, expect, it, vi } from "vitest";
import { erc20Abi } from "../src/chain/abi.js";
import { TREASURY } from "../src/constants.js";
import { planStableIndex, planStableWithdraw } from "../src/portfolio/stable-plan.js";
import { activeStableVaults, getStableCatalog, parseStableCatalog } from "../src/vaults/catalog.js";
import { erc4626Abi } from "../src/vaults/erc4626.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const OWNER = "0x000000000000000000000000000000000000dEaD";

function fakeClient(overrides: { shares?: bigint; assets?: bigint } = {}) {
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "asset") return USDC;
      if (functionName === "balanceOf") return overrides.shares ?? 0n;
      if (functionName === "convertToAssets") return overrides.assets ?? 0n;
      throw new Error(`unexpected read ${functionName}`);
    }),
  } as never;
}

describe("stable vault catalog", () => {
  it("parses the committed catalog with 10,000 bps of active weight on USDC", () => {
    const catalog = getStableCatalog();
    expect(catalog.chain).toBe("base");
    expect(catalog.asset.address.toLowerCase()).toBe(USDC.toLowerCase());
    const active = activeStableVaults(catalog);
    expect(active.length).toBeGreaterThan(0);
    expect(active.reduce((sum, vault) => sum + vault.weightBps, 0)).toBe(10_000);
    expect(new Set(catalog.vaults.map((vault) => vault.vault.toLowerCase())).size).toBe(catalog.vaults.length);
  });

  it("rejects catalogs whose active weights do not sum to 10,000", () => {
    const catalog = structuredClone(getStableCatalog()) as { vaults: Array<{ weightBps: number }> };
    catalog.vaults[0]!.weightBps += 1;
    expect(() => parseStableCatalog(catalog)).toThrow(/10,000/);
  });
});

describe("stable index plan", () => {
  it("plans fee, approve, and deposit per vault with exact weighting", async () => {
    const plan = await planStableIndex({ owner: OWNER, amountUnits: 1_000_000_000n, client: fakeClient() });
    const catalog = getStableCatalog();
    expect(plan.serviceFeeUnits).toBe(String((1_000_000_000n * BigInt(catalog.fees.allocateBps)) / 10_000n));
    const net = BigInt(plan.netAmountUnits);
    expect(net + BigInt(plan.serviceFeeUnits)).toBe(1_000_000_000n);
    const allocated = plan.allocations.reduce((sum, row) => sum + BigInt(row.amountUnits), 0n);
    expect(allocated).toBe(net);

    // fee transfer first, then approve+deposit pairs
    const fee = decodeFunctionData({ abi: erc20Abi, data: plan.transactions[0]!.data });
    expect(plan.transactions[0]!.to.toLowerCase()).toBe(USDC.toLowerCase());
    expect(fee.functionName).toBe("transfer");
    expect((fee.args as [string, bigint])[0].toLowerCase()).toBe(TREASURY.toLowerCase());

    for (const [index, allocation] of plan.allocations.entries()) {
      const approve = decodeFunctionData({ abi: erc20Abi, data: plan.transactions[1 + index * 2]!.data });
      expect(approve.functionName).toBe("approve");
      expect((approve.args as [string, bigint])[0].toLowerCase()).toBe(allocation.vault.toLowerCase());
      expect((approve.args as [string, bigint])[1]).toBe(BigInt(allocation.amountUnits));
      const deposit = decodeFunctionData({ abi: erc4626Abi, data: plan.transactions[2 + index * 2]!.data });
      expect(deposit.functionName).toBe("deposit");
      expect((deposit.args as [bigint, string])[0]).toBe(BigInt(allocation.amountUnits));
      expect((deposit.args as [bigint, string])[1].toLowerCase()).toBe(OWNER.toLowerCase());
      expect(plan.transactions[2 + index * 2]!.to.toLowerCase()).toBe(allocation.vault.toLowerCase());
    }
  });

  it("enforces the minimum deposit", async () => {
    await expect(planStableIndex({ owner: OWNER, amountUnits: 1_000n, client: fakeClient() }))
      .rejects.toThrow(/Minimum deposit/);
  });

  it("refuses a vault whose underlying is not the catalog asset", async () => {
    const client = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === "asset") return "0x0000000000000000000000000000000000000001";
        return 0n;
      }),
    } as never;
    await expect(planStableIndex({ owner: OWNER, amountUnits: 100_000_000n, client }))
      .rejects.toThrow(/does not match expected/);
  });
});

describe("stable withdraw plan", () => {
  it("redeems proportionally and takes the withdrawal fee", async () => {
    const plan = await planStableWithdraw({
      owner: OWNER,
      fractionBps: 5_000,
      client: fakeClient({ shares: 2_000_000n, assets: 2_100_000n }),
    });
    expect(plan.withdrawals.length).toBe(getStableCatalog().vaults.length);
    for (const withdrawal of plan.withdrawals) {
      expect(withdrawal.shares).toBe("1000000");
      expect(withdrawal.estimatedAssets).toBe("1050000");
    }
    const redeem = decodeFunctionData({ abi: erc4626Abi, data: plan.transactions[0]!.data });
    expect(redeem.functionName).toBe("redeem");
    expect((redeem.args as [bigint, string, string])[0]).toBe(1_000_000n);
    const last = plan.transactions.at(-1)!;
    const fee = decodeFunctionData({ abi: erc20Abi, data: last.data });
    expect(fee.functionName).toBe("transfer");
  });

  it("throws when nothing is held", async () => {
    await expect(planStableWithdraw({ owner: OWNER, client: fakeClient() })).rejects.toThrow(/No vault positions/);
  });
});
