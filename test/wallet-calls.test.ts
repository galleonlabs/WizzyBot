import { describe, expect, it, vi } from "vitest";
import { callsTerminalState, confirmedTransactionHashes, privySendCallsBody, privyTransactionTerminalState, relaySucceeded, sendPrivyWalletCallsAndWait, sendWalletCalls, sendWalletCallsAndWait } from "../app/lib/wallet-calls.js";

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

  it("waits for a Robinhood batch to confirm before resolving", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce("0xbundle")
      .mockResolvedValueOnce({ status: 100 })
      .mockResolvedValueOnce({ status: 200, receipts: [{ status: "0x1" }] });
    const result = await sendWalletCallsAndWait({
      wallet: {
        address: "0x1111111111111111111111111111111111111111",
        switchChain: async () => undefined,
        getEthereumProvider: async () => ({ request }),
      },
      owner: "0x1111111111111111111111111111111111111111",
      chainId: 4663,
      transactions: [{ to: "0x2222222222222222222222222222222222222222", data: "0x1234", value: "0", description: "test" }],
      pollingIntervalMs: 0,
    });
    expect(result.id).toBe("0xbundle");
    expect(request).toHaveBeenLastCalledWith({ method: "wallet_getCallsStatus", params: ["0xbundle"] });
  });

  it("never treats a reverted receipt as success", () => {
    expect(callsTerminalState({ status: 200, receipts: [{ status: "0x0" }] })).toBe("failure");
    expect(callsTerminalState({ status: 100 })).toBe("pending");
    expect(callsTerminalState({ status: "CONFIRMED", receipts: [{ status: "0x1" }] })).toBe("success");
  });

  it("builds the Privy Wallet API batch with sponsorship in the signed body", () => {
    expect(privySendCallsBody(4663, [{
      to: "0x2222222222222222222222222222222222222222",
      data: "0x1234",
      value: "16",
      description: "test",
    }])).toEqual({
      method: "wallet_sendCalls",
      caip2: "eip155:4663",
      chain_type: "ethereum",
      sponsor: true,
      params: { calls: [{ to: "0x2222222222222222222222222222222222222222", data: "0x1234", value: "0x10" }] },
    });
  });

  it("signs, submits, and waits for a confirmed Privy transaction", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { transaction_id: "12345678-abcd" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "pending" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "confirmed", transaction_hash: "0xabc" }), { status: 200 }));
    const generateAuthorizationSignature = vi.fn(async () => ({ signature: "signed-request-payload" }));
    const result = await sendPrivyWalletCallsAndWait({
      walletId: "wallet_12345678",
      appId: "app_12345678",
      owner: "0x1111111111111111111111111111111111111111",
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 4663,
      transactions: [{ to: "0x2222222222222222222222222222222222222222", data: "0x1234", value: "0", description: "test" }],
      generateAuthorizationSignature,
      fetcher,
      pollingIntervalMs: 0,
    });
    expect(generateAuthorizationSignature).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://api.privy.io/v1/wallets/wallet_12345678/rpc",
      body: expect.objectContaining({ sponsor: true }),
    }));
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/privy/calls", expect.objectContaining({ method: "POST" }));
    expect(result.status).toEqual({ status: "confirmed", transaction_hash: "0xabc" });
  });

  it("treats only confirmed Privy transactions as successful", () => {
    expect(privyTransactionTerminalState({ status: "pending" })).toBe("pending");
    expect(privyTransactionTerminalState({ status: "confirmed" })).toBe("success");
    expect(privyTransactionTerminalState({ status: "execution_reverted" })).toBe("failure");
  });

  it("extracts canonical receipt hashes without mistaking bundle IDs for transactions", () => {
    const hash = `0x${"ab".repeat(32)}`;
    expect(confirmedTransactionHashes({ id: "bundle_123", status: { transaction_hash: hash, receipts: [{ transactionHash: hash }] } })).toEqual([hash]);
    expect(confirmedTransactionHashes({ id: "0xbundle", status: "confirmed" })).toEqual([]);
  });
});
