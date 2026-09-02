import { describe, expect, it } from "vitest";
import { captureProtocol, confirmPhrase, isWrite, parseIntent, protocolOf } from "../src/agent/nlp.js";

describe("NL parser verbs", () => {
  it("covers list, status, mint, compound, range, exit, simulate", () => {
    expect(parseIntent("list").verb).toBe("list");
    const listed = parseIntent("list 0x1111111111111111111111111111111111111111");
    expect(listed.verb).toBe("list");
    if (listed.verb === "list") {
      expect(listed.owner).toBe("0x1111111111111111111111111111111111111111");
    }

    expect(parseIntent("status 12345")).toEqual({ verb: "status", tokenId: 12345n, owner: undefined, protocol: "V3" });
    expect(parseIntent("card #4242").verb).toBe("status");

    const mint = parseIntent("mint WETH/USDC 0.05% width 10");
    expect(mint.verb).toBe("mint");
    if (mint.verb === "mint") {
      expect(mint.token0).toBe("WETH");
      expect(mint.token1).toBe("USDC");
      expect(mint.fee).toBe(500);
      expect(mint.widthPct).toBe(10);
    }

    expect(parseIntent("compound 12345")).toEqual({ verb: "compound", tokenId: 12345n, protocol: "V3" });

    expect(parseIntent("range 12345").verb).toBe("rerange");
    expect(parseIntent("re-range 12345").verb).toBe("rerange");
    expect(parseIntent("rerange 999 oor 5")).toMatchObject({ verb: "rerange", tokenId: 999n, oorPercent: 5 });

    expect(parseIntent("exit 12345").verb).toBe("exit");
    expect(parseIntent("exit 12345 to USDC")).toMatchObject({ verb: "exit", swapTo: "USDC" });

    expect(parseIntent("simulate compound 12345")).toEqual({
      verb: "simulate",
      action: "compound",
      tokenId: 12345n,
      protocol: "V3",
    });
    expect(parseIntent("simulate range 12345")).toEqual({ verb: "simulate", action: "range", tokenId: 12345n, protocol: "V3" });
    expect(parseIntent("simulate exit 12345")).toEqual({ verb: "simulate", action: "exit", tokenId: 12345n, protocol: "V3" });
    expect(parseIntent("simulate mint WETH/USDC 0.05%").verb).toBe("simulate");
    expect(parseIntent("simulate mint WETH/USDC 0.05%")).toMatchObject({ verb: "simulate", action: "mint" });
  });

  it("marks writes and asks for yes", () => {
    expect(isWrite(parseIntent("status 1"))).toBe(false);
    expect(isWrite(parseIntent("list"))).toBe(false);
    expect(isWrite(parseIntent("simulate compound 12345"))).toBe(false);
    expect(isWrite(parseIntent("compound 12345"))).toBe(true);
    expect(isWrite(parseIntent("range 12345"))).toBe(true);
    expect(isWrite(parseIntent("exit 12345"))).toBe(true);
    expect(isWrite(parseIntent("mint WETH/USDC 0.05%"))).toBe(true);
    expect(confirmPhrase(parseIntent("compound 12345"))).toMatch(/yes/i);
    expect(confirmPhrase(parseIntent("range 12345"))).toMatch(/Re-range/);
  });

  it("accepts --protocol v2|v3|v4 and defaults to v3", () => {
    expect(captureProtocol("compound 12345")).toBe("V3");
    expect(captureProtocol("compound 12345 --protocol v4")).toBe("V4");
    expect(captureProtocol("list protocol=v2")).toBe("V2");
    expect(captureProtocol("status 12345 v4")).toBe("V4");
    expect(parseIntent("compound 12345")).toMatchObject({ verb: "compound", protocol: "V3" });
    expect(parseIntent("compound 12345 --protocol v4")).toMatchObject({ verb: "compound", tokenId: 12345n, protocol: "V4" });
    expect(parseIntent("list --protocol v2")).toMatchObject({ verb: "list", protocol: "V2" });
    expect(parseIntent("status 12345 protocol v4")).toMatchObject({ verb: "status", protocol: "V4" });
    expect(parseIntent("mint WETH/USDC 0.05% width 10 --protocol v2")).toMatchObject({ verb: "mint", protocol: "V2" });
    expect(parseIntent("simulate range 12345 --protocol v4")).toMatchObject({ verb: "simulate", action: "range", protocol: "V4" });
    expect(parseIntent("range 12345 v2")).toMatchObject({ verb: "rerange", protocol: "V2" });
    expect(parseIntent("exit 12345 --protocol v3")).toMatchObject({ verb: "exit", protocol: "V3" });
    expect(protocolOf(parseIntent("compound 12345"))).toBe("V3");
    expect(protocolOf(parseIntent("compound 12345 --protocol v4"))).toBe("V4");
    expect(() => parseIntent("exit 12345 --protocol v5")).toThrow(/v2\|v3\|v4/);
  });
});
