import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  estimateGas: vi.fn(),
  getAccount: vi.fn(),
  sendTransaction: vi.fn(),
  switchChain: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));
vi.mock("wagmi/actions", () => actions);

import { relaySucceeded, sendPlanTransactions, type WalletTransaction } from "../app/lib/wallet-calls.js";

const OWNER = "0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42";
const CONFIG = {} as never;
const PLAN: WalletTransaction[] = [
  { to: "0x0000000000000000000000000000000000000001", data: "0x01", value: "0", description: "Approve WETH" },
  { to: "0x0000000000000000000000000000000000000002", data: "0x02", value: "50000000000000000", description: "Mint the position" },
];

describe("external wallet plan execution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    actions.getAccount.mockReturnValue({ address: OWNER, chainId: 4663 });
    actions.estimateGas.mockResolvedValue(100_000n);
    actions.sendTransaction.mockResolvedValueOnce(`0x${"a".repeat(64)}`).mockResolvedValueOnce(`0x${"b".repeat(64)}`);
    actions.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
  });

  it("rejects an empty plan", async () => {
    await expect(sendPlanTransactions({ config: CONFIG, owner: OWNER, chainId: 4663, transactions: [] }))
      .rejects.toThrow(/plan is empty/);
  });

  it("rejects a connected wallet that is not the plan owner", async () => {
    actions.getAccount.mockReturnValue({ address: "0x000000000000000000000000000000000000dEaD", chainId: 4663 });
    await expect(sendPlanTransactions({ config: CONFIG, owner: OWNER, chainId: 4663, transactions: PLAN }))
      .rejects.toThrow(/does not match the plan owner/);
    expect(actions.sendTransaction).not.toHaveBeenCalled();
  });

  it("sends each transaction in order and reports per-step progress", async () => {
    const progress: string[] = [];
    const result = await sendPlanTransactions({
      config: CONFIG,
      owner: OWNER.toLowerCase(),
      chainId: 4663,
      transactions: PLAN,
      onProgress: ({ step, total, description }) => progress.push(`${step}/${total} ${description}`),
    });
    expect(actions.switchChain).not.toHaveBeenCalled();
    expect(actions.estimateGas).toHaveBeenCalledTimes(2);
    expect(actions.sendTransaction).toHaveBeenCalledTimes(2);
    expect(actions.sendTransaction).toHaveBeenNthCalledWith(2, CONFIG, {
      chainId: 4663,
      account: OWNER,
      to: PLAN[1]!.to,
      data: PLAN[1]!.data,
      value: 50000000000000000n,
    });
    expect(progress).toEqual(["1/2 Approve WETH", "2/2 Mint the position"]);
    expect(result.transactionHashes).toEqual([`0x${"a".repeat(64)}`, `0x${"b".repeat(64)}`]);
  });

  it("switches the wallet to the plan chain first when needed", async () => {
    actions.getAccount.mockReturnValue({ address: OWNER, chainId: 8453 });
    await sendPlanTransactions({ config: CONFIG, owner: OWNER, chainId: 4663, transactions: PLAN });
    expect(actions.switchChain).toHaveBeenCalledWith(CONFIG, { chainId: 4663 });
  });

  it("stops the plan when a transaction reverts", async () => {
    actions.waitForTransactionReceipt.mockReset();
    actions.waitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted" });
    await expect(sendPlanTransactions({ config: CONFIG, owner: OWNER, chainId: 4663, transactions: PLAN }))
      .rejects.toThrow(/"Approve WETH" reverted onchain/);
    expect(actions.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("simulates every step after the prior receipt and stops before signing stale calldata", async () => {
    const order: string[] = [];
    actions.estimateGas
      .mockImplementationOnce(async () => { order.push("simulate-1"); return 100_000n; })
      .mockImplementationOnce(async () => { order.push("simulate-2"); throw new Error("execution reverted"); });
    actions.sendTransaction.mockReset();
    actions.sendTransaction.mockImplementationOnce(async () => { order.push("send-1"); return `0x${"a".repeat(64)}`; });
    actions.waitForTransactionReceipt.mockImplementationOnce(async () => { order.push("receipt-1"); return { status: "success" }; });

    await expect(sendPlanTransactions({ config: CONFIG, owner: OWNER, chainId: 4663, transactions: PLAN }))
      .rejects.toThrow(/"Mint the position" is no longer executable/);
    expect(order).toEqual(["simulate-1", "send-1", "receipt-1", "simulate-2"]);
    expect(actions.sendTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("relay status", () => {
  it("recognizes completed relay states", () => {
    expect(relaySucceeded({ status: "success" })).toBe(true);
    expect(relaySucceeded({ state: "FILLED" })).toBe(true);
    expect(relaySucceeded({ status: "pending" })).toBe(false);
    expect(relaySucceeded(null)).toBe(false);
  });
});
