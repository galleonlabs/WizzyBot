import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ADDRESSES, CHAIN_ID, TREASURY } from "../constants.js";
import { addressesFor, parseChainSlug, viemChainFor } from "../chains.js";
import { parseProtocol, parseTokenId } from "../core/protocol.js";
import type { Protocol } from "../types.js";

const str = z.string();
const opt = z.string().optional();

export const MCP_TOOL_DEFS = [
  { name: "list", description: "List LP positions (v2, v3, v4)", required: ["owner"] },
  { name: "status", description: "Status / position card: range, fees, APR, HOLD", required: ["tokenId"] },
  { name: "mint", description: "Mint a position. Dry-run unless live=true.", required: ["token0", "token1", "fee"] },
  { name: "compound", description: "Compound: collect, optional swap, increase. Take unless noFee.", required: ["tokenId"] },
  { name: "range", description: "Range: same-width recenter when out of range", required: ["tokenId"] },
  { name: "exit", description: "Exit a position, optional swap to one token", required: ["tokenId"] },
  { name: "simulate", description: "Simulate compound | range | exit | mint without broadcast", required: ["action"] },
  { name: "pool_info", description: "Pool state for a pair + fee", required: ["token0", "token1", "fee"] },
  { name: "position_list", description: "List LP positions for a wallet (same as list)", required: ["owner"] },
  { name: "position_pnl", description: "Status / position card vs HOLD (same as status)", required: ["tokenId"] },
  { name: "quote_mint", description: "Quote a mint with tick snap (single- or two-sided)", required: ["token0", "token1", "fee"] },
  { name: "create", description: "Mint a position (same as mint). Dry-run unless live=true.", required: ["token0", "token1", "fee"] },
  { name: "increase", description: "Increase liquidity of an existing position", required: ["tokenId"] },
  { name: "decrease", description: "Decrease liquidity of an existing position", required: ["tokenId"] },
  { name: "claim", description: "Claim / collect uncollected fees", required: ["tokenId"] },
  { name: "rebalance", description: "Range: same-width recenter (same as range)", required: ["tokenId"] },
] as const;

const MCP_NAME_ALIAS: Record<string, string> = {
  list: "position_list",
  status: "position_pnl",
  mint: "create",
  range: "rebalance",
};

export const MCP_TOOLS = MCP_TOOL_DEFS.map((t) => t.name);

export function listMcpTools(): string[] {
  return [...MCP_TOOLS];
}

const mintFields = {
  token0: str.describe("token0 address, ETH, or WETH"),
  token1: str.describe("token1 address, ETH, or WETH"),
  fee: str.describe("100 | 500 | 3000 | 10000"),
  widthPct: opt,
  tickLower: opt,
  tickUpper: opt,
  amount0: opt,
  amount1: opt,
  owner: opt,
  live: opt,
  protocol: opt.describe("v2 | v3 | v4 (default v3)"),
  chain: opt.describe("base | robinhood (default base)"),
};

export function schemaFor(name: string): z.ZodRawShape {
  name = MCP_NAME_ALIAS[name] ?? name;
  switch (name) {
    case "pool_info":
      return { token0: str, token1: str, fee: str, protocol: opt, chain: opt };
    case "position_list":
      return { owner: str, protocol: opt, chain: opt };
    case "position_pnl":
      return { tokenId: str, protocol: opt, chain: opt };
    case "quote_mint":
    case "create":
      return mintFields;
    case "increase":
    case "decrease":
    case "claim":
    case "compound":
    case "rebalance":
    case "exit":
      return { tokenId: str, owner: opt, live: opt, noFee: opt, feeSource: opt, pct: opt, swapTo: opt, oorPercent: opt, protocol: opt, chain: opt };
    case "simulate":
      return { action: str, tokenId: opt, token0: opt, token1: opt, fee: opt, widthPct: opt, amount0: opt, amount1: opt, protocol: opt, chain: opt };
    default:
      return {};
  }
}


export function chainFromArgs(args: Record<string, unknown> = {}): ReturnType<typeof parseChainSlug> {
  if (args.chain === undefined || args.chain === null || args.chain === "") return parseChainSlug("base");
  return parseChainSlug(String(args.chain));
}

export function protocolFromArgs(args: Record<string, unknown> = {}): Protocol {
  if (args.protocol === undefined || args.protocol === null || args.protocol === "") return parseProtocol("v3");
  return parseProtocol(String(args.protocol));
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "unabot", version: "1.0.0" });
  for (const tool of MCP_TOOL_DEFS) {
    const register = (
      server as unknown as {
        registerTool: (
          name: string,
          cfg: { description: string; inputSchema: z.ZodRawShape },
          handler: (args: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[] }>,
        ) => void;
        tool?: (
          name: string,
          cfg: { description: string; inputSchema: z.ZodRawShape },
          handler: (args: Record<string, unknown>) => Promise<{ content: { type: "text"; text: string }[] }>,
        ) => void;
      }
    );
    const fn = register.registerTool?.bind(server) ?? register.tool?.bind(server);
    if (!fn) throw new Error("@modelcontextprotocol/sdk McpServer missing registerTool/tool");
    fn(
      tool.name,
      { description: tool.description, inputSchema: schemaFor(tool.name) },
      async (args) => ({
        content: [{ type: "text", text: await callTool(tool.name, args ?? {}) }],
      }),
    );
  }
  return server;
}

export async function startMcpStdio(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  name = MCP_NAME_ALIAS[name] ?? name;
  const { loadEnv } = await import("../config/env.js");
  const { makePublicClient } = await import("../signer/broadcast.js");
  const { planCompound, planExit, planRerange, formatReceipt } = await import("../core/actions.js");
  const { usdPricesForPosition, snapshotUsd } = await import("../chain/prices.js");
  const { buildCard, formatCard } = await import("../core/card.js");
  const { getHold, holdAmounts, formatHoldNote } = await import("../core/hold.js");
  const { importHoldForToken } = await import("../chain/mint-history.js");
  const { adapterFor } = await import("../core/protocols.js");
  const env = loadEnv();
  const chain = chainFromArgs(args);
  const client = makePublicClient(env.rpcByChain[chain], viemChainFor(chain));
  const protocol = protocolFromArgs(args);
  const adapter = adapterFor(protocol, client);

  if (name === "pool_info") {
    const { factoryAbi, poolAbi } = await import("../chain/abi.js");
    const { getAddress } = await import("viem");
    const pool = await client.readContract({
      address: addressesFor(chain).factory,
      abi: factoryAbi,
      functionName: "getPool",
      args: [getAddress(String(args.token0)), getAddress(String(args.token1)), Number(args.fee)],
    });
    if (pool === addressesFor(chain).nativeEth) return JSON.stringify({ chainId: client.chain?.id ?? CHAIN_ID, pool: null, error: "pool not found" });
    const slot0 = await client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" });
    return JSON.stringify({ chainId: client.chain?.id ?? CHAIN_ID, pool, tick: slot0[1], sqrtPriceX96: slot0[0].toString() });
  }

  if (name === "position_list") {
    adapter.bindOwner?.(args.owner as `0x${string}`);
    const refs = await adapter.listPositions(args.owner as `0x${string}`);
    return JSON.stringify(refs.map((r) => ({ tokenId: r.tokenId.toString(), protocol: r.protocol })));
  }

  if (name === "position_pnl") {
    const tokenId = parseTokenId(String(args.tokenId), protocol);
    const snap = await adapter.readPosition(tokenId);
    let rec = getHold(tokenId);
    if (!rec) rec = await importHoldForToken(client, tokenId, { amount0: snap.amount0, amount1: snap.amount1 });
    const hold = holdAmounts(rec);
    const px = await usdPricesForPosition(client, snap, env.ethUsd);
    const card = buildCard(snap, px, hold, rec.createdAt, undefined, { source: rec.source, note: formatHoldNote(rec) });
    return formatCard(card);
  }

  if (name === "quote_mint" || name === "create") {
    return quoteOrCreate(name, args, { client, env, live: args.live === true || args.live === "true" });
  }

  const owner = (args.owner as `0x${string}`) ?? "0x0000000000000000000000000000000000000001";
  adapter.bindOwner?.(owner);
  if (["increase", "decrease", "claim", "compound", "rebalance", "exit", "simulate"].includes(name)) {
    if (name === "simulate" && (String(args.action) === "mint" || String(args.action) === "create")) {
      return quoteOrCreate("quote_mint", args, { client, env, live: false });
    }
    const snap = await adapter.readPosition(parseTokenId(String(args.tokenId), protocol));
    const px = await usdPricesForPosition(client, snap, env.ethUsd);
    const usd = snapshotUsd(snap, px.price0Usd, px.price1Usd);
    const ctx = {
      owner,
      dryRun: args.live !== true && args.live !== "true",
      noFee: Boolean(args.noFee),
      feeSource: (args.feeSource as "fees" | "notional") ?? "fees",
      minFeeUsd: 1,
      minPositionUsd: 50,
      feesUsd: usd.feesUsd,
      notionalUsd: usd.positionUsd,
      gasUsd: 0.15,
      takeBps: 200,
    };
    const action = name === "simulate" ? String(args.action) : name;
    const receipt =
      action === "compound" || action === "claim" || action === "increase"
        ? planCompound(snap, ctx)
        : action === "rebalance" || action === "rerange" || action === "range" || action === "decrease"
          ? planRerange(snap, ctx, { oorPercent: Number(args.oorPercent ?? 0) })
          : planExit(snap, ctx, { swapTo: args.swapTo as `0x${string}` | undefined });
    return formatReceipt(receipt);
  }

  return `unknown tool ${name}`;
}

async function quoteOrCreate(
  name: string,
  args: Record<string, unknown>,
  ctx: { client: import("viem").PublicClient; env: { uniswapApiKey?: string }; live: boolean },
): Promise<string> {
  const { getAddress } = await import("viem");
  const { runMintFlow } = await import("../core/mint-flow.js");
  const protocol = protocolFromArgs(args);
  const owner = args.owner ? getAddress(String(args.owner)) : "0x0000000000000000000000000000000000000001";
  const result = await runMintFlow({
    client: ctx.client,
    owner,
    token0: String(args.token0),
    token1: String(args.token1),
    fee: Number(args.fee),
    protocol,
    widthPct: args.widthPct !== undefined ? Number(args.widthPct) : undefined,
    tickLower: args.tickLower !== undefined ? Number(args.tickLower) : undefined,
    tickUpper: args.tickUpper !== undefined ? Number(args.tickUpper) : undefined,
    amount0: args.amount0 !== undefined ? BigInt(String(args.amount0)) : undefined,
    amount1: args.amount1 !== undefined ? BigInt(String(args.amount1)) : undefined,
    dryRun: !ctx.live,
    apiKey: ctx.env.uniswapApiKey,
  });
  const quote = result.quote;
  return JSON.stringify(
    {
      tool: name,
      protocol: protocol.toLowerCase(),
      dryRun: !ctx.live,
      chainId: ctx.client.chain?.id ?? CHAIN_ID,
      treasury: TREASURY,
      quote: {
        ...quote,
        amount0: quote.amount0.toString(),
        amount1: quote.amount1.toString(),
        sqrtPriceX96: quote.sqrtPriceX96.toString(),
      },
      receipt: {
        action: result.receipt.action,
        skipped: result.receipt.skipped,
        actions: result.receipt.actions.map((x) => x.description),
      },
      card: result.card,
      note: "NFT minted to the user wallet. No vault custody. create === mint.",
    },
    null,
    2,
  );
}
