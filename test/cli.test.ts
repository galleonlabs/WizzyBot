import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { buildProgram, liveFlag, protocolFlag, PRODUCT_LINE } from "../src/cli/index.js";
import { MCP_TOOLS } from "../src/mcp/server.js";
import { PRODUCT_VERBS } from "../src/copy.js";

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

  it("is product-led: short line, no org name, not v3-only", () => {
    const help = buildProgram().helpInformation();
    expect(help).toContain(PRODUCT_LINE);
    expect(help).toContain("v2, v3, v4");
    expect(help).toContain("You own every position");
    expect(help).not.toContain("Liquidity, as an agent");
    expect(help).not.toMatch(/galleon/i);
    expect(help).not.toMatch(/v3-only|v3 only|v3 NFTs/i);
    expect(help).toMatch(/Import existing positions \(v2, v3, v4\)/);
  });

  it("advertises live execution without obsolete fee controls", () => {
    const help = buildProgram().helpInformation();
    expect(help).toContain("--live");
    expect(help).not.toContain("--no-fee");
    expect(help).not.toContain("--fee-source");
  });

  it("parses the live helper", () => {
    expect(liveFlag({})).toBe(false);
    expect(liveFlag({ live: true })).toBe(true);
  });

  it("parses --protocol v2|v3|v4 and defaults to v3", () => {
    expect(protocolFlag({})).toBe("V3");
    expect(protocolFlag({ protocol: "v3" })).toBe("V3");
    expect(protocolFlag({ protocol: "v2" })).toBe("V2");
    expect(protocolFlag({ protocol: "v4" })).toBe("V4");
    expect(() => protocolFlag({ protocol: "v5" })).toThrow(/v2\|v3\|v4/);
    const simulate = buildProgram().commands.find((c) => c.name() === "simulate");
    expect(simulate?.helpInformation()).toMatch(/--protocol/);
  });

  it("documents --protocol on write verbs", async () => {
    const program = buildProgram();
    const mint = program.commands.find((c) => c.name() === "mint");
    const list = program.commands.find((c) => c.name() === "list");
    expect(mint?.helpInformation()).toMatch(/--protocol/);
    expect(list?.helpInformation()).toMatch(/--protocol/);
    expect(mint?.helpInformation()).toMatch(/v2 \| v3 \| v4/);
    const run = program.commands.find((c) => c.name() === "run");
    expect(run?.helpInformation()).toMatch(/dry-run/i);
    expect(run?.helpInformation()).toMatch(/--live/);
  });

  it("registers MCP tools required by the spec", () => {
    expect(MCP_TOOLS).toEqual(expect.arrayContaining([...PRODUCT_VERBS]));
    expect(MCP_TOOLS).toEqual(
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
  });
});
