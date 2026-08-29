import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { ADDRESSES, CHAIN_ID, TREASURY } from "../constants.js";

interface JsonRpcReq {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

const TOOLS = [
  { name: "pool_info", description: "Base Uniswap v3 pool state for a pair + fee", inputSchema: objectSchema(["token0", "token1", "fee"]) },
  { name: "position_list", description: "List v3 NFTs for a wallet", inputSchema: objectSchema(["owner"]) },
  { name: "position_pnl", description: "Position card / PnL vs HOLD", inputSchema: objectSchema(["tokenId"]) },
  { name: "quote_mint", description: "Quote a mint with tick snap", inputSchema: objectSchema(["token0", "token1", "fee", "widthPct"]) },
  { name: "create", description: "Create (mint) a v3 position. Dry-run unless live=true.", inputSchema: objectSchema(["token0", "token1", "fee"]) },
  { name: "increase", description: "Increase liquidity of an existing NFT", inputSchema: objectSchema(["tokenId"]) },
  { name: "decrease", description: "Decrease liquidity of an existing NFT", inputSchema: objectSchema(["tokenId", "pct"]) },
  { name: "claim", description: "Claim / collect uncollected fees", inputSchema: objectSchema(["tokenId"]) },
  { name: "compound", description: "Collect → optional swap → increase. 2% fee to treasury unless noFee.", inputSchema: objectSchema(["tokenId"]) },
  { name: "rebalance", description: "Auto-range same-width recenter", inputSchema: objectSchema(["tokenId"]) },
  { name: "exit", description: "Fully exit a position, optional swap to one token", inputSchema: objectSchema(["tokenId"]) },
  { name: "simulate", description: "Simulate compound | rebalance | exit without broadcast", inputSchema: objectSchema(["action", "tokenId"]) },
];

function objectSchema(required: string[]) {
  return {
    type: "object",
    properties: Object.fromEntries(required.map((k) => [k, { type: "string" }])),
    required,
  };
}

export async function startMcpStdio(): Promise<void> {
  const rl = createInterface({ input: stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: JsonRpcReq;
    try {
      req = JSON.parse(trimmed) as JsonRpcReq;
    } catch {
      write({ jsonrpc: "2.0", error: { code: -32700, message: "parse error" }, id: null });
      return;
    }
    void handle(req);
  });
}

async function handle(req: JsonRpcReq): Promise<void> {
  const id = req.id ?? null;
  try {
    if (req.method === "initialize") {
      write({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "unabot", version: "1.0.0" },
          capabilities: { tools: {} },
        },
      });
      return;
    }
    if (req.method === "notifications/initialized") return;
    if (req.method === "tools/list") {
      write({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    }
    if (req.method === "tools/call") {
      const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const result = await callTool(params.name ?? "", params.arguments ?? {});
      write({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: result }] } });
      return;
    }
    write({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method ${req.method}` } });
  } catch (err) {
    write({
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
    });
  }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const { loadEnv } = await import("../config/env.js");
  const { makePublicClient } = await import("../signer/broadcast.js");
  const { V3Adapter } = await import("../chain/positions.js");
  const { planCompound, planExit, planRerange, formatReceipt } = await import("../core/actions.js");
  const { usdPricesForPosition, snapshotUsd } = await import("../chain/prices.js");
  const { buildCard, formatCard } = await import("../core/card.js");
  const env = loadEnv();
  const client = makePublicClient(env.rpcUrl);
  const adapter = new V3Adapter(client);

  if (name === "pool_info") {
    const { factoryAbi, poolAbi } = await import("../chain/abi.js");
    const pool = await client.readContract({
      address: ADDRESSES.factory,
      abi: factoryAbi,
      functionName: "getPool",
      args: [args.token0 as `0x${string}`, args.token1 as `0x${string}`, Number(args.fee)],
    });
    const slot0 = await client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" });
    return JSON.stringify({ chainId: CHAIN_ID, pool, tick: slot0[1], sqrtPriceX96: slot0[0].toString() });
  }

  if (name === "position_list") {
    const refs = await adapter.listPositions(args.owner as `0x${string}`);
    return JSON.stringify(refs.map((r) => r.tokenId.toString()));
  }

  if (name === "position_pnl") {
    const snap = await adapter.readPosition(BigInt(String(args.tokenId)));
    const px = await usdPricesForPosition(client, snap, env.ethUsd);
    const card = buildCard(snap, px, { hold0: snap.amount0, hold1: snap.amount1 });
    return formatCard(card);
  }

  const owner = (args.owner as `0x${string}`) ?? "0x0000000000000000000000000000000000000001";
  if (name === "quote_mint" || name === "create") {
    return JSON.stringify({
      dryRun: args.live !== true,
      action: name,
      chainId: CHAIN_ID,
      treasury: TREASURY,
      args,
      note: "NFT minted to the user wallet. No vault custody.",
    });
  }

  if (["increase", "decrease", "claim", "compound", "rebalance", "exit", "simulate"].includes(name)) {
    const snap = await adapter.readPosition(BigInt(String(args.tokenId)));
    const px = await usdPricesForPosition(client, snap, env.ethUsd);
    const usd = snapshotUsd(snap, px.price0Usd, px.price1Usd);
    const ctx = {
      owner,
      dryRun: args.live !== true,
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

function write(msg: unknown): void {
  stdout.write(JSON.stringify(msg) + "\n");
}

export const MCP_TOOLS = TOOLS.map((t) => t.name);
