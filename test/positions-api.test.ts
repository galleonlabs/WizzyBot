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

  it("preserves Uniswap protocol identity in action requests", () => {
    const src = readFileSync("app/api/portfolio/action/route.ts", "utf8");
    expect(src).toContain('protocol: z.enum(["V2", "V3", "V4"]).optional()');
    expect(src).toContain("protocol: body.protocol");
  });

  it("reads V2, V3, V4, and curated Aerodrome positions without silently forcing V3", () => {
    const statusRoute = readFileSync(tokenRoute, "utf8");
    const hostedLoader = readFileSync(loader, "utf8");
    const hostedSurface = readFileSync("src/surfaces/hosted.ts", "utf8");
    expect(statusRoute).toContain("protocolFromRequest");
    expect(statusRoute).toContain("positionManager");
    expect(hostedLoader).toContain("protocol: EvmProtocol");
    expect(hostedSurface).toContain("AERODROME_DEPLOYMENTS");
    expect(hostedSurface).toContain("connectRead(slug, { protocol, positionManager })");
    expect(hostedSurface).not.toContain("new V3Adapter(client)");
  });
});
