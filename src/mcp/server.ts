import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ADDRESSES, CHAIN_ID, TREASURY } from "../constants.js";

const str = z.string();
const opt = z.string().optional();

export const MCP_TOOL_DEFS = [
  { name: "pool_info", description: "Pool state for a pair + fee", required: ["token0", "token1", "fee"] },
  { name: "position_list", description: "List LP positions for a wallet", required: ["owner"] },
  { name: "position_pnl", description: "Position card / PnL vs persisted HOLD", required: ["tokenId"] },
  { name: "quote_mint", description: "Quote a mint with tick snap (single- or two-sided)", required: ["token0", "token1", "fee"] },
  { name: "create", description: "Create (mint) a position. Dry-run unless live=true. Same as mint.", required: ["token0", "token1", "fee"] },
  { name: "increase", description: "Increase liquidity of an existing NFT", required: ["tokenId"] },
  { name: "decrease", description: "Decrease liquidity of an existing NFT", required: ["tokenId"] },
  { name: "claim", description: "Claim / collect uncollected fees", required: ["tokenId"] },
  { name: "compound", description: "Collect → optional swap → increase. Take unless noFee.", required: ["tokenId"] },
  { name: "rebalance", description: "Auto-range same-width recenter", required: ["tokenId"] },
  { name: "exit", description: "Fully exit a position, optional swap to one token", required: ["tokenId"] },
  { name: "simulate", description: "Simulate compound | rebalance | exit | mint without broadcast", required: ["action"] },
] as const;

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
};

function schemaFor(name: string): z.ZodRawShape {
  switch (name) {
    case "pool_info":
      return { token0: str, token1: str, fee: str };
    case "position_list":
      return { owner: str };
    case "position_pnl":
      return { tokenId: str };
    case "quote_mint":
    case "create":
      return mintFields;
    case "increase":
    case "decrease":
    case "claim":
    case "compound":
    case "rebalance":
    case "exit":
      return { tokenId: str, owner: opt, live: opt, noFee: opt, feeSource: opt, pct: opt, swapTo: opt, oorPercent: opt };
    case "simulate":
      return { action: str, tokenId: opt, token0: opt, token1: opt, fee: opt, widthPct: opt, amount0: opt, amount1: opt };
    default:
      return {};
  }
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
  const { loadEnv } = await import("../config/env.js");
  const { makePublicClient } = await import("../signer/broadcast.js");
  const { V3Adapter } = await import("../chain/positions.js");
  const { planCompound, planExit, planRerange, formatReceipt } = await import("../core/actions.js");
  const { usdPricesForPosition, snapshotUsd } = await import("../chain/prices.js");
  const { buildCard, formatCard } = await import("../core/card.js");
  const { getHold, holdAmounts, formatHoldNote, rememberHold } = await import("../core/hold.js");
  const { importHoldForToken } = await import("../chain/mint-history.js");
  const { quoteMintFromPool, planMint, formatMintQuote, loadPoolForMint, resolveMintToken, sortPoolPair } = await import("../core/mint.js");
  const env = loadEnv();
  const client = makePublicClient(env.rpcUrl);
  const adapter = new V3Adapter(client);

  if (name === "pool_info") {
    const { factoryAbi, poolAbi } = await import("../chain/abi.js");
    const { getAddress } = await import("viem");
    const pool = await client.readContract({
      address: ADDRESSES.factory,
      abi: factoryAbi,
      functionName: "getPool",
      args: [getAddress(String(args.token0)), getAddress(String(args.token1)), Number(args.fee)],
    });
    if (pool === ADDRESSES.nativeEth) return JSON.stringify({ chainId: CHAIN_ID, pool: null, error: "pool not found" });
    const slot0 = await client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" });
    return JSON.stringify({ chainId: CHAIN_ID, pool, tick: slot0[1], sqrtPriceX96: slot0[0].toString() });
  }

  if (name === "position_list") {
    const refs = await adapter.listPositions(args.owner as `0x${string}`);
    return JSON.stringify(refs.map((r) => r.tokenId.toString()));
  }

  if (name === "position_pnl") {
    const tokenId = BigInt(String(args.tokenId));
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
  if (["increase", "decrease", "claim", "compound", "rebalance", "exit", "simulate"].includes(name)) {
    if (name === "simulate" && String(args.action) === "mint") {
      return quoteOrCreate("quote_mint", args, { client, env, live: false });
    }
    const snap = await adapter.readPosition(BigInt(String(args.tokenId)));
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
        : action === "rebalance" || action === "rerange" || action === "decrease"
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
  const { quoteMintFromPool, planMint, formatMintQuote, loadPoolForMint, resolveMintToken, sortPoolPair } = await import("../core/mint.js");
  const a = resolveMintToken(String(args.token0));
  const b = resolveMintToken(String(args.token1));
  const [t0, t1] = sortPoolPair(
    { address: a.address, useNative: a.useNative, amount: args.amount0 ? BigInt(String(args.amount0)) : 0n },
    { address: b.address, useNative: b.useNative, amount: args.amount1 ? BigInt(String(args.amount1)) : 0n },
  );
  const fee = Number(args.fee);
  const pool = await loadPoolForMint(ctx.client, t0.address, t1.address, fee);
  const { readTokenMeta } = await import("../chain/positions.js");
  const token0 = await readTokenMeta(ctx.client, t0.address);
  const token1 = await readTokenMeta(ctx.client, t1.address);
  const quote = quoteMintFromPool({
    token0,
    token1,
    fee,
    sqrtPriceX96: pool.sqrtPriceX96,
    tickCurrent: pool.tick,
    pool: pool.pool,
    widthPct: args.widthPct !== undefined ? Number(args.widthPct) : undefined,
    tickLower: args.tickLower !== undefined ? Number(args.tickLower) : undefined,
    tickUpper: args.tickUpper !== undefined ? Number(args.tickUpper) : undefined,
    amount0Desired: t0.amount,
    amount1Desired: t1.amount,
    useNative: t0.useNative || t1.useNative,
    nativeIsToken0: t0.useNative,
  });
  const owner = args.owner ? getAddress(String(args.owner)) : "0x0000000000000000000000000000000000000001";
  const receipt = planMint(quote, owner, !ctx.live);
  return JSON.stringify(
    {
      tool: name,
      dryRun: !ctx.live,
      chainId: CHAIN_ID,
      treasury: TREASURY,
      quote: {
        ...quote,
        amount0: quote.amount0.toString(),
        amount1: quote.amount1.toString(),
        sqrtPriceX96: quote.sqrtPriceX96.toString(),
      },
      receipt: {
        action: receipt.action,
        skipped: receipt.skipped,
        actions: receipt.actions.map((x) => x.description),
      },
      card: formatMintQuote(quote),
      note: "NFT minted to the user wallet. No vault custody. create === mint.",
    },
    null,
    2,
  );
}
