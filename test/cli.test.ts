import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { buildProgram } from "../src/cli/index.js";
import { MCP_TOOLS } from "../src/mcp/server.js";

describe("CLI --help smoke", () => {
  it("exposes the v1 verbs", async () => {
    const program = buildProgram();
    expect(program).toBeInstanceOf(Command);
    const help = program.helpInformation();
    for (const verb of [
      "list",
      "import",
      "status",
      "mint",
      "compound",
      "range",
      "exit",
      "simulate",
      "run",
      "chat",
      "mcp",
      "config",
      "pool",
      "telegram",
    ]) {
      expect(help).toContain(verb);
    }
    expect(help).toMatch(/dry-run|Dry-run|dry run/i);
  });

  it("registers MCP tools required by the spec", () => {
    expect(MCP_TOOLS.sort()).toEqual(
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
  });
});
