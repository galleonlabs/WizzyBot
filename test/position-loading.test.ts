import { describe, expect, it } from "vitest";
import { loadPositionRows } from "../app/lib/position-loading.js";

describe("multi-chain position loading", () => {
  it("keeps positions from a healthy chain when another chain fails", async () => {
    const fetcher = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("chain=base")) throw new Error("Base RPC timed out");
      return Response.json({ positions: [{ chain: "robinhood", tokenId: "940346" }] });
    };

    const result = await loadPositionRows("0x30154567d96eACa13F0Bd1A4150eD938f05b507C", fetcher as typeof fetch);

    expect(result.rows).toEqual([{ chain: "robinhood", tokenId: "940346" }]);
    expect(result.failedChains).toEqual(["base"]);
  });
});
