import { describe, expect, it } from "vitest";
import { MCP_TOOLS, MCP_TOOL_DEFS, listMcpTools, createMcpServer, schemaFor, protocolFromArgs } from "../src/mcp/server.js";
import { PRODUCT_VERBS } from "../src/copy.js";

describe("MCP listTools", () => {
  it("advertises product verbs and the required spec names", () => {
    const tools = listMcpTools();
    expect(tools).toEqual(MCP_TOOLS);
    for (const verb of PRODUCT_VERBS) {
      expect(tools).toContain(verb);
    }
    expect(tools).toEqual(
      expect.arrayContaining([
        "claim",
        "compound",
        "create",
        "decrease",
        "exit",
        "increase",
        "pool_info",
        "position_list",
        "position_pnl",
        "quote_mint",
        "rebalance",
        "simulate",
      ]),
    );
    expect(tools).toContain("create");
    expect(tools).toContain("mint");
    expect(tools).toContain("range");
  });

  it("tool descriptions match verbs: list, status, mint, compound, range, exit, simulate", () => {
    for (const verb of PRODUCT_VERBS) {
      const def = MCP_TOOL_DEFS.find((t) => t.name === verb);
      expect(def, verb).toBeTruthy();
      expect(def!.description.toLowerCase()).toContain(verb);
    }
  });

  it("registers the same names on the official SDK server", () => {
    const server = createMcpServer();
    expect(server).toBeTruthy();
    const registered = (server as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools;
    if (registered) {
      expect(Object.keys(registered).sort()).toEqual(listMcpTools().sort());
    }
  });

  it("accepts protocol on tools and defaults to v3", () => {
    const verbs = ["list", "status", "mint", "compound", "range", "exit", "simulate", "create", "position_list", "position_pnl", "quote_mint", "rebalance"];
    for (const name of verbs) {
      const shape = schemaFor(name);
      expect(shape, name).toHaveProperty("protocol");
    }
    expect(protocolFromArgs({})).toBe("V3");
    expect(protocolFromArgs({ protocol: undefined })).toBe("V3");
    expect(protocolFromArgs({ protocol: "" })).toBe("V3");
    expect(protocolFromArgs({ protocol: "v3" })).toBe("V3");
    expect(protocolFromArgs({ protocol: "v2" })).toBe("V2");
    expect(protocolFromArgs({ protocol: "v4" })).toBe("V4");
    expect(protocolFromArgs({ protocol: "2" })).toBe("V2");
    expect(protocolFromArgs({ protocol: "4" })).toBe("V4");
    expect(() => protocolFromArgs({ protocol: "v5" })).toThrow(/v2\|v3\|v4/);
  });
});
