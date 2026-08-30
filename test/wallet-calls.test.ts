import { describe, expect, it, vi } from "vitest";
import { relaySucceeded, sendWalletCalls } from "../app/lib/wallet-calls.js";

describe("client wallet batches", () => {
  it("switches chain and asks the wallet for one atomic batch", async () => {
    const request = vi.fn(async (_args: unknown) => "0xbundle");
    const switchChain = vi.fn(async () => undefined);
    const result = await sendWalletCalls({
      wallet: {
        address: "0x1111111111111111111111111111111111111111",
        switchChain,
        getEthereumProvider: async () => ({ request }),
      },
      owner: "0x1111111111111111111111111111111111111111",
      chainId: 8453,
      transactions: [{
        to: "0x2222222222222222222222222222222222222222",
        data: "0x1234",
        value: "16",
        description: "test",
      }],
    });
    expect(switchChain).toHaveBeenCalledWith(8453);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: "wallet_sendCalls" }));
    const requestArgs = request.mock.calls[0]![0] as { params: Array<{ calls: Array<{ value: string }> }>; sponsor?: boolean };
    expect(requestArgs.params[0]!.calls[0]!.value).toBe("0x10");
    expect(requestArgs.sponsor).toBeUndefined();
    expect(result).toEqual({ id: "0xbundle", chainId: 8453, callCount: 1 });
  });

  it("requests Privy sponsorship only for Robinhood batches", async () => {
    const request = vi.fn(async (_args: unknown) => "0xsponsored-bundle");
    await sendWalletCalls({
      wallet: {
        address: "0x1111111111111111111111111111111111111111",
        switchChain: async () => undefined,
        getEthereumProvider: async () => ({ request }),
      },
      owner: "0x1111111111111111111111111111111111111111",
      chainId: 4663,
      transactions: [{
        to: "0x2222222222222222222222222222222222222222",
        data: "0x1234",
        value: "16",
        description: "test",
      }],
    });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: "wallet_sendCalls",
      sponsor: true,
    }));
  });

  it("recognizes only terminal successful Relay states", () => {
    expect(relaySucceeded({ status: "success" })).toBe(true);
    expect(relaySucceeded({ state: "filled" })).toBe(true);
    expect(relaySucceeded({ status: "pending" })).toBe(false);
  });
});
