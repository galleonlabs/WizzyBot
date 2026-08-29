import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { positionsApiPayload } from "../src/core/view.js";

const route = "app/api/positions/route.ts";
const tokenRoute = "app/api/positions/[tokenId]/route.ts";
const loader = "app/lib/hosted-server.ts";

describe("positions API route", () => {
  it("exists and loads hosted via CJS, not Uniswap ESM", () => {
    expect(existsSync(route)).toBe(true);
    expect(existsSync(tokenRoute)).toBe(true);
    const src = readFileSync(route, "utf8") + readFileSync(tokenRoute, "utf8") + readFileSync(loader, "utf8");
    expect(src).toContain("createRequire");
    expect(src).toContain("vendor/hosted-cjs/index.cjs");
    expect(src).not.toContain("@uniswap/sdk-core");
    expect(src).not.toContain("@uniswap/v3-sdk");
    expect(src).not.toContain("src/surfaces/hosted");
  });

  it("shapes an empty envelope when the wallet is missing", () => {
    const empty = positionsApiPayload({
      positions: [],
      error: "Connect a wallet to load positions.",
    });
    expect(empty.count).toBe(0);
    expect(empty.positions).toEqual([]);
    expect(empty.error).toMatch(/wallet/i);
    expect(readFileSync(loader, "utf8")).toContain("Connect a wallet to load positions.");
  });
});
