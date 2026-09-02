import { describe, expect, it } from "vitest";
import { addressesFor, chainOf } from "../src/chains.js";
import { tokenUsd } from "../src/chain/prices.js";

describe("chain-aware USD pricing", () => {
  it("uses Robinhood's factory and USDG quote asset", async () => {
    const calls: Array<{ address: string; args?: readonly unknown[] }> = [];
    const client = {
      chain: chainOf("robinhood").viem,
      readContract: async (request: { address: string; args?: readonly unknown[] }) => {
        calls.push(request);
        throw new Error("pool unavailable");
      },
    };

    await expect(tokenUsd(client as never, addressesFor("robinhood").weth, 18, 3_000)).resolves.toBe(3_000);
    expect(calls[0]).toMatchObject({
      address: addressesFor("robinhood").factory,
      args: [addressesFor("robinhood").weth, addressesFor("robinhood").usdg, 500],
    });
  });
});
