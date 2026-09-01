import { describe, expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";
import {
  derivePoolActivity,
  fetchRecentPoolActivity,
  mergePoolActivityItems,
  type DecodedPoolActivityLog,
  type PoolActivityClient,
} from "../src/markets/activity.js";
import { activeMarkets } from "../src/markets/catalog.js";

const HASH_A = `0x${"a".repeat(64)}` as Hash;
const HASH_B = `0x${"b".repeat(64)}` as Hash;

describe("pool activity", () => {
  it("turns target-pool mint and burn logs into newest-first activity", () => {
    const markets = activeMarkets("robinhood");
    const cashcat = markets.find((market) => market.symbol === "CASHCAT")!;
    const pons = markets.find((market) => market.symbol === "PONS")!;
    const logs: DecodedPoolActivityLog[] = [
      log(cashcat.pool, "Mint", 100n, HASH_A, { amount0: 4_000_000_000_000_000_000n, amount1: 820_000_000_000_000_000n }),
      log(pons.pool, "Burn", 101n, HASH_B, { amount0: 210_000_000_000_000_000n, amount1: 8_000_000_000_000_000_000n }),
    ];

    expect(derivePoolActivity(markets, logs)).toEqual([
      expect.objectContaining({ kind: "removed", symbol: "PONS", pair: "PONS/WETH", wethAmount: "0.21", blockNumber: "101" }),
      expect.objectContaining({ kind: "added", symbol: "CASHCAT", pair: "CASHCAT/WETH", wethAmount: "0.82", blockNumber: "100" }),
    ]);
  });

  it("ignores logs outside the reviewed pools and omits zero-sided WETH amounts", () => {
    const markets = activeMarkets("robinhood");
    const cashcat = markets.find((market) => market.symbol === "CASHCAT")!;
    const logs: DecodedPoolActivityLog[] = [
      log(cashcat.pool, "Mint", 100n, HASH_A, { amount0: 2_000_000_000_000_000_000n, amount1: 0n }),
      log("0x0000000000000000000000000000000000000001", "Burn", 101n, HASH_B, { amount0: 1n, amount1: 1n }),
    ];

    expect(derivePoolActivity(markets, logs)).toEqual([
      expect.objectContaining({ symbol: "CASHCAT", wethAmount: null }),
    ]);
  });

  it("uses exactly one head read and one multi-pool, multi-event log query", async () => {
    const getBlockNumber = vi.fn(async () => 10_000n);
    const getLogs = vi.fn(async () => [] as DecodedPoolActivityLog[]);
    const client: PoolActivityClient = { getBlockNumber, getLogs };

    const result = await fetchRecentPoolActivity({ client, blockWindow: 500n });

    expect(result).toMatchObject({ asOfBlock: "10000", scannedBlocks: 500, rpcRequests: 2, items: [] });
    expect(getBlockNumber).toHaveBeenCalledOnce();
    expect(getLogs).toHaveBeenCalledOnce();
    expect(getLogs).toHaveBeenCalledWith(expect.objectContaining({
      address: expect.arrayContaining(activeMarkets("robinhood").map((market) => market.pool)),
      events: expect.arrayContaining([expect.objectContaining({ name: "Mint" }), expect.objectContaining({ name: "Burn" })]),
      fromBlock: 9_501n,
      toBlock: 10_000n,
      strict: true,
    }));
  });

  it("falls back to the next client when the activity rpc fails", async () => {
    const failing: PoolActivityClient = {
      getBlockNumber: vi.fn(async () => { throw new Error("the method eth_getLogs does not exist"); }),
      getLogs: vi.fn(async () => [] as DecodedPoolActivityLog[]),
    };
    const working: PoolActivityClient = {
      getBlockNumber: vi.fn(async () => 10_000n),
      getLogs: vi.fn(async () => [] as DecodedPoolActivityLog[]),
    };

    const result = await fetchRecentPoolActivity({ clients: [failing, working], blockWindow: 500n });

    expect(result).toMatchObject({ asOfBlock: "10000", scannedBlocks: 500, rpcRequests: 2, items: [] });
    expect(failing.getBlockNumber).toHaveBeenCalledOnce();
    expect(working.getLogs).toHaveBeenCalledOnce();
  });

  it("retries the remaining attempts when a log scan is rejected mid-flight", async () => {
    const calls: bigint[] = [];
    const strictThenPermissive: PoolActivityClient = {
      getBlockNumber: vi.fn(async () => 10_000n),
      getLogs: vi.fn(async (input: { fromBlock: bigint; toBlock: bigint }) => {
        calls.push(input.toBlock - input.fromBlock + 1n);
        if (calls.length === 1) throw new Error("invalid params");
        return [] as DecodedPoolActivityLog[];
      }),
    };
    const result = await fetchRecentPoolActivity({ clients: [strictThenPermissive, strictThenPermissive] });
    expect(result).toMatchObject({ asOfBlock: "10000", items: [] });
    expect(calls).toEqual([1_000n, 1_000n]);
  });

  it("merges fresh scans into prior items newest-first without duplicates", () => {
    const item = (id: string, blockNumber: string) => ({ id, blockNumber });
    const previous = [item("c", "300"), item("a", "100")];
    const fresh = [item("d", "400"), item("c", "300"), item("b", "200")];
    expect(mergePoolActivityItems(previous, fresh).map((row) => row.id)).toEqual(["d", "c", "b", "a"]);
    expect(mergePoolActivityItems(previous, fresh, 2).map((row) => row.id)).toEqual(["d", "c"]);
    expect(mergePoolActivityItems([], [])).toEqual([]);
  });

  it("rethrows when every client fails", async () => {
    const failing: PoolActivityClient = {
      getBlockNumber: vi.fn(async () => { throw new Error("invalid request"); }),
      getLogs: vi.fn(async () => [] as DecodedPoolActivityLog[]),
    };
    await expect(fetchRecentPoolActivity({ clients: [failing] })).rejects.toThrow("invalid request");
  });
});

function log(
  address: Address,
  eventName: "Mint" | "Burn",
  blockNumber: bigint,
  transactionHash: Hash,
  args: { amount0: bigint; amount1: bigint },
): DecodedPoolActivityLog {
  return { address, eventName, blockNumber, transactionHash, args, logIndex: 1 };
}
