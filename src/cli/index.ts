#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import { getAddress, isAddress, type Address } from "viem";
import { ADDRESSES, CHAIN_ID, TREASURY } from "../constants.js";
import { loadEnv } from "../config/env.js";
import { loadConfig, policyFor } from "../config/policy.js";
import { loadAccount } from "../signer/account.js";
import { makePublicClient } from "../signer/broadcast.js";
import { V3Adapter } from "../chain/positions.js";
import { snapshotUsd, usdPricesForPosition } from "../chain/prices.js";
import { buildCard, formatCard } from "../core/card.js";
import { formatReceipt, planCompound, planExit, planRerange, type PlanContext } from "../core/actions.js";
import { extraAllowForMint, persistMintHold, runMintFlow } from "../core/mint-flow.js";
import { formatHoldNote, getHold, holdAmounts } from "../core/hold.js";
import { importHoldForToken } from "../chain/mint-history.js";
import { runTelegramLoop } from "../surfaces/telegram.js";
import { COMPOUND_FEE_BPS, RANGE_EXIT_FEE_BPS } from "../core/fees.js";
import { rangeFromWidthPct, snapRange, tickSpacingForFee } from "../core/ticks.js";
import { parseIntent, confirmPhrase, isWrite, type Intent } from "../agent/nlp.js";
import { StdoutSink } from "../keeper/alerts.js";
import { runLoop, runOnce } from "../keeper/loop.js";
import { startMcpStdio } from "../mcp/server.js";
import type { PositionSnapshot } from "../types.js";

const program = new Command();

program
  .name("unabot")
  .description("Uniswap LP on autopilot. v2, v3, and v4. You keep the position.")
  .version("1.0.0")
  .argument("[utterance...]", "natural-language command, e.g. unabot \"status 12345\"")
  .option("--live", "broadcast transactions (default is dry-run)", false)
  .option("--no-fee", "skip the take", false)
  .option("--fee-source <source>", "fees | notional", "fees")
  .option("--config <path>", "policy file (merged over ~/.unabot/config.json)")
  .action(async (utterance: string[], opts) => {
    if (utterance.length === 0) {
      program.outputHelp();
      return;
    }
    await runChat(utterance.join(" "), opts);
  });

function liveFlag(opts: { live?: boolean }, cmd?: Command): boolean {
  return Boolean(opts.live || cmd?.optsWithGlobals?.().live || program.opts().live);
}

function noFeeFlag(opts: { noFee?: boolean; fee?: boolean } = {}): boolean {
  const global = program.opts() as { noFee?: boolean; fee?: boolean };
  if (opts.noFee || global.noFee) return true;
  if (opts.fee === false || global.fee === false) return true;
  return false;
}

function feeSourceFlag(opts: { feeSource?: string }): "fees" | "notional" {
  const v = opts.feeSource ?? program.opts().feeSource ?? "fees";
  if (v !== "fees" && v !== "notional") throw new Error("--fee-source must be fees|notional");
  return v;
}

program
  .command("list")
  .description("List LP positions (v2, v3, v4)")
  .option("--owner <address>", "wallet to inspect (default: signer)")
  .action(async (opts) => {
    const { client, owner } = await connect(opts.owner);
    const { adapterFor } = await import("../core/protocols.js");
    let any = false;
    for (const protocol of ["V2", "V3", "V4"] as const) {
      const adapter = adapterFor(protocol, client);
      let refs: { protocol: string; tokenId: bigint }[] = [];
      try {
        refs = await adapter.listPositions(owner);
      } catch {
        refs = [];
      }
      for (const ref of refs) {
        any = true;
        try {
          const snap = await adapter.readPosition(ref.tokenId);
          console.log(`${ref.protocol} ${ref.tokenId}  ${snap.token0.symbol}/${snap.token1.symbol}  fee=${snap.fee}  ${snap.inRange ? "in-range" : "OOR"}`);
        } catch (err) {
          console.log(`${ref.protocol} ${ref.tokenId}  (${err instanceof Error ? err.message : err})`);
        }
      }
    }
    if (!any) console.log(`No positions for ${owner}`);
  });

program
  .command("import")
  .description("Import v3 NFTs via tokenOfOwnerByIndex and Transfer logs")
  .option("--owner <address>", "wallet to import")
  .option("--from-block <n>", "log start block")
  .action(async (opts) => {
    const { adapter, owner, client } = await connect(opts.owner);
    const indexed = await adapter.listPositions(owner);
    const logged = await adapter.importViaLogs(owner, opts.fromBlock ? BigInt(opts.fromBlock) : undefined);
    const ids = new Set([...indexed.map((r) => r.tokenId), ...logged]);
    console.log(`owner=${owner} indexed=${indexed.length} logs=${logged.length} unique=${ids.size} rpc=${client.chain?.id ?? CHAIN_ID}`);
    for (const id of ids) {
      const snap = await adapter.readPosition(id);
      const rec = await importHoldForToken(client, id, { amount0: snap.amount0, amount1: snap.amount1 }, {
        fromBlock: opts.fromBlock ? BigInt(opts.fromBlock) : undefined,
      });
      console.log(`${id} HOLD source=${rec.source} hold0=${rec.hold0} hold1=${rec.hold1}`);
    }
  });

program
  .command("status")
  .alias("card")
  .description("Position card: range, amounts, fees, APR, HOLD, divergence")
  .argument("<tokenId>", "NFPM tokenId")
  .action(async (tokenId: string) => {
    const { adapter, env, client } = await connectRead();
    const id = BigInt(tokenId);
    const snap = await adapter.readPosition(id);
    const prices = await usdPricesForPosition(client, snap, env.ethUsd);
    let rec = getHold(id);
    if (!rec) {
      rec = await importHoldForToken(client, id, { amount0: snap.amount0, amount1: snap.amount1 });
    }
    const card = buildCard(snap, prices, holdAmounts(rec), rec.createdAt, undefined, {
      source: rec.source,
      note: formatHoldNote(rec),
    });
    console.log(formatCard(card));
  });

program
  .command("pool")
  .description("Pool info")
  .requiredOption("--token0 <address>")
  .requiredOption("--token1 <address>")
  .requiredOption("--fee <fee>", "100 | 500 | 3000 | 10000")
  .action(async (opts) => {
    const { client } = await connectRead();
    const { factoryAbi, poolAbi } = await import("../chain/abi.js");
    const pool = await client.readContract({
      address: ADDRESSES.factory,
      abi: factoryAbi,
      functionName: "getPool",
      args: [getAddress(opts.token0), getAddress(opts.token1), Number(opts.fee)],
    });
    if (pool === ADDRESSES.nativeEth) {
      console.log("pool not found");
      return;
    }
    const slot0 = await client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" });
    console.log(JSON.stringify({ pool, sqrtPriceX96: slot0[0].toString(), tick: slot0[1], fee: Number(opts.fee) }, null, 2));
  });

program
  .command("mint")
  .description("Mint a position. Dry-run by default.")
  .requiredOption("--token0 <address>")
  .requiredOption("--token1 <address>")
  .requiredOption("--fee <fee>")
  .option("--width <pct>", "percent width around current price (±pct)")
  .option("--tick-lower <n>")
  .option("--tick-upper <n>")
  .option("--amount0 <raw>")
  .option("--amount1 <raw>")
  .option("--owner <address>", "recipient / signer override (dry-run may omit key)")
  .action(async (opts, cmd) => {
    const live = liveFlag(cmd.optsWithGlobals(), cmd);
    const { client, owner, env, account } = await connect(opts.owner, { optional: !live });
    const result = await runMintFlow({
      client,
      owner,
      token0: opts.token0,
      token1: opts.token1,
      fee: Number(opts.fee),
      widthPct: opts.width ? Number(opts.width) : undefined,
      tickLower: opts.tickLower ? Number(opts.tickLower) : undefined,
      tickUpper: opts.tickUpper ? Number(opts.tickUpper) : undefined,
      amount0: opts.amount0 ? BigInt(opts.amount0) : undefined,
      amount1: opts.amount1 ? BigInt(opts.amount1) : undefined,
      dryRun: !live,
      apiKey: env.uniswapApiKey,
    });
    console.log(result.card);
    console.log(formatReceipt(result.receipt));
    console.log(`lpApi=${result.usedLpApi} simulate=${JSON.stringify(result.simulation)}`);
    if (!live) {
      console.log("dry-run: no broadcast. Pass --live and type yes to send allowlisted mint txs.");
      return;
    }
    await confirmOrThrow("Broadcast mint? NFT stays in your wallet.");
    if (!account) throw new Error("UNABOT_PRIVATE_KEY required for --live mint");
    const { sendPlannedTx } = await import("../signer/broadcast.js");
    const extra = extraAllowForMint(result.quote);
    for (const tx of result.receipt.txs) {
      const sent = await sendPlannedTx({ rpcUrl: env.rpcUrl, account, tx, extraAllow: extra, live: true });
      console.log(tx.description, "hash" in sent ? sent.hash : "dry-run");
    }
    persistMintHold(result.quote, 0n);
    console.log("HOLD for the new tokenId is persisted on next import/status once the NFT exists.");
  });

program
  .command("compound")
  .description("Collect fees, optional swap to ratio, increase. Skips if uneconomic.")
  .argument("<tokenId>")
  .action(async (tokenId: string, _opts, cmd) => {
    const receipt = await planFor("compound", BigInt(tokenId), cmd);
    printReceipt(receipt);
    await maybeBroadcast(receipt, cmd);
  });

program
  .command("range")
  .alias("rerange")
  .description("Auto-range: same-width recenter when OOR (or near-edge).")
  .argument("<tokenId>")
  .option("--oor <pct>", "0 = only fully OOR", "0")
  .action(async (tokenId: string, opts, cmd) => {
    const receipt = await planFor("rerange", BigInt(tokenId), cmd, { oorPercent: Number(opts.oor) });
    printReceipt(receipt);
    await maybeBroadcast(receipt, cmd);
  });

program
  .command("exit")
  .description("Exit at price (or now). Optional swap to one token.")
  .argument("<tokenId>")
  .option("--price <n>", "trigger price token1/token0")
  .option("--swap-to <address>", "optional single-token exit")
  .action(async (tokenId: string, opts, cmd) => {
    const receipt = await planFor("exit", BigInt(tokenId), cmd, {
      exitPrice: opts.price ? Number(opts.price) : undefined,
      swapTo: opts.swapTo,
    });
    printReceipt(receipt);
    await maybeBroadcast(receipt, cmd);
  });

program
  .command("simulate")
  .description("Print planned actions without broadcasting")
  .argument("<action>", "compound | rerange | exit")
  .argument("<tokenId>")
  .action(async (action: string, tokenId: string, _opts, cmd) => {
    if (action !== "compound" && action !== "rerange" && action !== "exit") {
      throw new Error("action must be compound|rerange|exit");
    }
    const receipt = await planFor(action, BigInt(tokenId), cmd);
    printReceipt(receipt);
  });

program
  .command("run")
  .description("Keeper loop: log skip/execute decisions for configured tokenIds")
  .option("--interval <ms>", "poll interval", "30000")
  .option("--once", "single pass", false)
  .action(async (opts, cmd) => {
    const live = liveFlag(cmd.optsWithGlobals(), cmd);
    const { adapter, owner, client, env } = await connect();
    const sink = new StdoutSink();
    const deps = {
      list: async (who: Address) => {
        const refs = await adapter.listPositions(who);
        return Promise.all(refs.map((r) => adapter.readPosition(r.tokenId)));
      },
      owner,
      live,
      intervalMs: Number(opts.interval),
      sink,
      prices: async (p: PositionSnapshot) => {
        const px = await usdPricesForPosition(client, p, env.ethUsd);
        const usd = snapshotUsd(p, px.price0Usd, px.price1Usd);
        return {
          feesUsd: usd.feesUsd,
          notionalUsd: usd.positionUsd,
          gasUsd: 0.15,
          price: Number(p.sqrtPriceX96) > 0 ? (Number(p.sqrtPriceX96) / 2 ** 96) ** 2 : 0,
        };
      },
    };
    if (opts.once) {
      await runOnce(deps);
    } else {
      await runLoop(deps);
    }
  });

program
  .command("chat")
  .description("Chat. Live writes require confirmation.")
  .action(async (_opts, cmd) => {
    const rl = createInterface({ input, output });
    console.log("UnaBot chat. You keep the NFT. Dry-run unless --live. Type help or quit.");
    try {
      while (true) {
        const line = (await rl.question("> ")).trim();
        if (!line) continue;
        if (/^(quit|exit)$/i.test(line)) break;
        await runChat(line, cmd.optsWithGlobals());
      }
    } finally {
      rl.close();
    }
  });

program
  .command("mcp")
  .description("MCP stdio server for Claude / Bankr")
  .action(async () => {
    await startMcpStdio();
  });

program
  .command("telegram")
  .description("Telegram. Confirm before live.")
  .action(async (_opts, cmd) => {
    const env = loadEnv();
    const live = liveFlag(cmd.optsWithGlobals(), cmd);
    await runTelegramLoop({
      token: env.telegramBotToken,
      live,
      execute: async (text) => {
        const prev = console.log;
        const chunks: string[] = [];
        console.log = (...a: unknown[]) => {
          chunks.push(a.map(String).join(" "));
        };
        try {
          await runChat(text, { live });
        } finally {
          console.log = prev;
        }
        return chunks.join("\n") || "ok";
      },
    });
  });

program
  .command("config")
  .description("Print merged policy (cwd + ~/.unabot/config.json)")
  .action(() => {
    console.log(JSON.stringify(loadConfig(), null, 2));
  });

async function connectRead() {
  const env = loadEnv();
  const client = makePublicClient(env.rpcUrl);
  return { env, client, adapter: new V3Adapter(client) };
}

async function connect(ownerArg?: string, opts: { optional?: boolean } = {}) {
  const { env, client, adapter } = await connectRead();
  const account = loadAccount(env);
  const owner = ownerArg
    ? getAddress(ownerArg)
    : account?.address ?? (opts.optional ? getAddress("0x0000000000000000000000000000000000000001") : undefined);
  if (!owner) throw new Error("Pass --owner or set UNABOT_PRIVATE_KEY");
  return { env, client, account, owner, adapter };
}

async function planFor(
  action: "compound" | "rerange" | "exit",
  tokenId: bigint,
  cmd: Command,
  extra: { oorPercent?: number; exitPrice?: number; swapTo?: string } = {},
) {
  const { adapter, owner, client, env } = await connect();
  const snap = await adapter.readPosition(tokenId);
  const px = await usdPricesForPosition(client, snap, env.ethUsd);
  const usd = snapshotUsd(snap, px.price0Usd, px.price1Usd);
  const policy = policyFor(loadConfig(), tokenId);
  const ctx: PlanContext = {
    owner,
    dryRun: !liveFlag(cmd.optsWithGlobals(), cmd),
    noFee: noFeeFlag(program.opts()),
    feeSource: feeSourceFlag(program.opts()),
    minFeeUsd: policy.minFeeUsd,
    minPositionUsd: policy.minPositionUsd,
    feesUsd: usd.feesUsd,
    notionalUsd: usd.positionUsd,
    gasUsd: 0.15,
    takeBps: action === "compound" ? COMPOUND_FEE_BPS : RANGE_EXIT_FEE_BPS,
  };
  if (action === "compound") return planCompound(snap, ctx);
  if (action === "rerange") return planRerange(snap, ctx, { oorPercent: extra.oorPercent ?? policy.oorPercent });
  return planExit(snap, ctx, {
    exitPrice: extra.exitPrice ?? policy.exitPrice,
    currentPrice: extra.exitPrice ? (Number(snap.sqrtPriceX96) / 2 ** 96) ** 2 : undefined,
    swapTo: extra.swapTo && isAddress(extra.swapTo) ? getAddress(extra.swapTo) : policy.exitToken && isAddress(policy.exitToken) ? getAddress(policy.exitToken) : undefined,
  });
}

function printReceipt(receipt: ReturnType<typeof planCompound>): void {
  console.log(formatReceipt(receipt));
}

async function maybeBroadcast(receipt: ReturnType<typeof planCompound>, cmd: Command): Promise<void> {
  const live = liveFlag(cmd.optsWithGlobals(), cmd);
  if (receipt.skipped) return;
  if (!live) {
    console.log("dry-run: no broadcast. Pass --live and type yes to send allowlisted txs.");
    return;
  }
  await confirmOrThrow(`Broadcast ${receipt.action} tokenId=${receipt.tokenId}?`);
  const { adapter, owner, env, account } = await connect();
  if (!account || receipt.tokenId === undefined) throw new Error("signer and tokenId required");
  const { hydrateCalldata } = await import("../core/hydrate.js");
  const { sendPlannedTx } = await import("../signer/broadcast.js");
  const { allowlistWithTokens } = await import("../signer/allowlist.js");
  const snap = await adapter.readPosition(receipt.tokenId);
  const filled = hydrateCalldata(receipt, snap, owner);
  const extra = allowlistWithTokens(snap.token0.address, snap.token1.address);
  for (const tx of filled.txs) {
    const sent = await sendPlannedTx({ rpcUrl: env.rpcUrl, account, tx, extraAllow: extra, live: true });
    console.log(tx.description, "hash" in sent ? sent.hash : "dry-run");
  }
}

async function confirmOrThrow(prompt: string): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error("Refusing --live without a TTY confirmation");
  }
  const rl = createInterface({ input, output });
  try {
    const ans = (await rl.question(`${prompt} [yes/N] `)).trim().toLowerCase();
    if (ans !== "yes") throw new Error("cancelled");
  } finally {
    rl.close();
  }
}

async function runChat(text: string, opts: { live?: boolean }): Promise<void> {
  const intent = parseIntent(text);
  if (intent.verb === "help") {
    program.outputHelp();
    return;
  }
  if (intent.verb === "unknown") {
    console.log(`Could not parse: ${intent.text}`);
    return;
  }
  if (opts.live && isWrite(intent)) {
    console.log(confirmPhrase(intent));
    if (process.stdin.isTTY) {
      await confirmOrThrow("Confirm live write");
    }
  }
  await dispatchIntent(intent);
}

async function dispatchIntent(intent: Intent): Promise<void> {
  switch (intent.verb) {
    case "list":
      await program.parseAsync(["node", "unabot", "list", ...(intent.owner ? ["--owner", intent.owner] : [])]);
      break;
    case "status":
      if (intent.tokenId === undefined) {
        await program.parseAsync(["node", "unabot", "list"]);
      } else {
        await program.parseAsync(["node", "unabot", "status", String(intent.tokenId)]);
      }
      break;
    case "compound":
      await program.parseAsync(["node", "unabot", "compound", String(intent.tokenId)]);
      break;
    case "rerange":
      await program.parseAsync(["node", "unabot", "range", String(intent.tokenId)]);
      break;
    case "exit":
      await program.parseAsync(["node", "unabot", "exit", String(intent.tokenId)]);
      break;
    case "mint":
      console.log(JSON.stringify(intent, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
      console.log("Use: unabot mint --token0 <addr> --token1 <addr> --fee <n> --width <pct>");
      break;
    default:
      break;
  }
}

export function buildProgram(): Command {
  return program;
}

export { snapRange, rangeFromWidthPct, tickSpacingForFee };

const entry = process.argv[1] ?? "";
if (/unabot(\.(mjs|js))?$/.test(entry) || /cli\/index\.(js|ts)$/.test(entry)) {
  program.parseAsync(process.argv).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
