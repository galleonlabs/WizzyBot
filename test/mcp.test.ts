import { describe, expect, it } from "vitest";
import { MCP_TOOLS, listMcpTools, createMcpServer } from "../src/mcp/server.js";

describe("MCP listTools", () => {
  it("advertises the required tool names including create (mint)", () => {
    const tools = listMcpTools();
    expect(tools).toEqual(MCP_TOOLS);
    expect(tools.sort()).toEqual(
      [
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
      ].sort(),
    );
    expect(tools).toContain("create");
  });

  it("registers the same names on the official SDK server", () => {
    const server = createMcpServer();
    expect(server).toBeTruthy();
    const registered = (server as unknown as { _registeredTools?: Record<string, unknown> })._registeredTools;
    if (registered) {
      expect(Object.keys(registered).sort()).toEqual(listMcpTools().sort());
    }
  });
});
