#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import { getAddress, isAddress, type Address } from "viem";
import { ADDRESSES, CHAIN_ID } from "../constants.js";
import { loadEnv } from "../config/env.js";
import { loadConfig, policyFor } from "../config/policy.js";
import { loadAccount } from "../signer/account.js";
import { makePublicClient } from "../signer/broadcast.js";
import { adapterFor } from "../core/protocols.js";
import { parseProtocol, parseTokenId } from "../core/protocol.js";
import type { Protocol } from "../types.js";
import { snapshotUsd, usdPricesForPosition } from "../chain/prices.js";
import { buildCard, formatCard } from "../core/card.js";
import { formatReceipt, planCompound, planExit, planRerange, type PlanContext } from "../core/actions.js";
import { extraAllowForMint, persistMintHold, runMintFlow } from "../core/mint-flow.js";
import { formatHoldNote, getHold, holdAmounts } from "../core/hold.js";
import { importHoldForToken } from "../chain/mint-history.js";
import { runTelegramLoop } from "../surfaces/telegram.js";
import { COMPOUND_FEE_BPS, NOTIONAL_FEE_BPS, RANGE_EXIT_FEE_BPS } from "../core/fees.js";
import { rangeFromWidthPct, snapRange, tickSpacingForFee } from "../core/ticks.js";
import { parseIntent, confirmPhrase, isWrite, protocolOf, type Intent } from "../agent/nlp.js";
import { PRODUCT_LINE, PRODUCT_HELP } from "../copy.js";
import { StdoutSink } from "../keeper/alerts.js";
import { runLoop, runOnce } from "../keeper/loop.js";
import { startMcpStdio } from "../mcp/server.js";
import type { PositionSnapshot } from "../types.js";

const program = new Command();

program
  .name("unabot")
  .description(PRODUCT_LINE)
  .version("1.0.0")
  .argument("[utterance...]", "natural-language command, e.g. unabot \"status 12345\"")
  .option("--live", "broadcast (default is dry-run)")
  .option("--no-fee", "skip the take")
  .option("--fee-source <source>", "fees | notional", "fees")
  .option("--config <path>", "policy file (merged over ~/.unabot/config.json)")
  .action(async (utterance: string[], opts) => {
    if (utterance.length === 0) {
      program.outputHelp();
      return;
    }
    await runChat(utterance.join(" "), opts);
  });

export function liveFlag(opts: { live?: boolean } = {}, cmd?: Command): boolean {
  return Boolean(opts.live || cmd?.optsWithGlobals?.().live || program.opts().live);
}

export function noFeeFlag(opts: { noFee?: boolean; fee?: boolean } = {}): boolean {
  if (opts.noFee) return true;
  if (opts.fee === false) return true;
  const global = program.opts() as { noFee?: boolean; fee?: boolean };
  if (global.noFee) return true;
  if (global.fee === false) return true;
  return false;
}

export function feeSourceFlag(opts: { feeSource?: string } = {}): "fees" | "notional" {
  const v = opts.feeSource ?? (program.opts() as { feeSource?: string }).feeSource ?? "fees";
  if (v !== "fees" && v !== "notional") throw new Error("--fee-source must be fees|notional");
  return v;
}

export function protocolFlag(opts: { protocol?: string } = {}): Protocol {
  return parseProtocol(opts.protocol ?? "v3");
}

program
  .command("list")
  .description("List positions (v2, v3, v4)")
  .option("--owner <address>", "wallet to inspect (default: signer)")
  .option("--protocol <v>", "v2 | v3 | v4 (default v3)", "v3")
  .action(async (opts) => {
    const protocol = protocolFlag(opts);
    const { client, owner } = await connect(opts.owner, { protocol });
    let any = false;
    for (const proto of [protocol]) {
      const adapter = adapterFor(proto, client);
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
  .description("Import existing positions (v2, v3, v4)")
  .option("--owner <address>", "wallet to import")
  .option("--from-block <n>", "log start block")
  .action(async (opts) => {
    const { owner, client } = await connect(opts.owner);
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
      let logged: bigint[] = [];
      if (typeof adapter.importViaLogs === "function") {
        try {
          logged = await adapter.importViaLogs(owner, opts.fromBlock ? BigInt(opts.fromBlock) : undefined);
        } catch {
          logged = [];
        }
      }
      const ids = new Set([...refs.map((r) => r.tokenId), ...logged]);
      if (ids.size) any = true;
      console.log(`${protocol} owner=${owner} indexed=${refs.length} logs=${logged.length} unique=${ids.size} rpc=${client.chain?.id ?? CHAIN_ID}`);
      for (const id of ids) {
        try {
          const snap = await adapter.readPosition(id);
          const rec = await importHoldForToken(client, id, { amount0: snap.amount0, amount1: snap.amount1 }, {
            fromBlock: opts.fromBlock ? BigInt(opts.fromBlock) : undefined,
          });
          console.log(`${protocol} ${id} HOLD source=${rec.source} hold0=${rec.hold0} hold1=${rec.hold1}`);
        } catch (err) {
          console.log(`${protocol} ${id}  (${err instanceof Error ? err.message : err})`);
        }
      }
    }
    if (!any) console.log(`No positions for ${owner}`);
  });

program
  .command("status")
  .alias("card")
  .description("Status / position card")
  .argument("<tokenId>", "NFT tokenId, or v2 pair address")
  .option("--protocol <v>", "v2 | v3 | v4 (default v3)", "v3")
  .action(async (tokenId: string, opts) => {
    const protocol = protocolFlag(opts);
    const { adapter, env, client, owner } = await connect(undefined, { optional: true, protocol });
    adapter.bindOwner?.(owner);
    const id = parseTokenId(tokenId, protocol);
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
  .description("Mint a position. Dry-run default.")
  .requiredOption("--token0 <address>")
  .requiredOption("--token1 <address>")
  .requiredOption("--fee <fee>")
  .option("--width <pct>", "percent width around current price (±pct)")
  .option("--tick-lower <n>")
  .option("--tick-upper <n>")
  .option("--amount0 <raw>")
  .option("--amount1 <raw>")
  .option("--owner <address>", "recipient / signer override (dry-run may omit key)")
  .option("--protocol <v>", "v2 | v3 | v4 (default v3)", "v3")
  .action(async (opts, cmd) => {
    const live = liveFlag(cmd.optsWithGlobals(), cmd);
    const protocol = protocolFlag(opts);
    const { client, owner, env, account } = await connect(opts.owner, { optional: !live, protocol });
    const result = await runMintFlow({
      client,
      owner,
      token0: opts.token0,
      token1: opts.token1,
      fee: Number(opts.fee),
      protocol,
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
    // tokenId is unknown until the mint receipt is mined; persistMintHold no-ops on 0n.
    persistMintHold(result.quote, 0n);
    console.log("HOLD for the new tokenId is persisted on next import/status once the NFT exists.");
  });

program
  .command("compound")
  .description("Compound fees into the position")
  .argument("<tokenId>")
  .option("--protocol <v>", "v2 | v3 | v4 (default v3)", "v3")
  .action(async (tokenId: string, opts, cmd) => {
    const receipt = await planFor("compound", parseTokenId(tokenId, protocolFlag(opts)), cmd, { protocol: protocolFlag(opts) });
    printReceipt(receipt);
    await maybeBroadcast(receipt, cmd);
  });

program
  .command("range")
  .alias("rerange")
  .description("Re-range when out of range")
  .argument("<tokenId>")
  .option("--oor <pct>", "0 = only fully OOR", "0")
  .option("--protocol <v>", "v2 | v3 | v4 (default v3)", "v3")
  .action(async (tokenId: string, opts, cmd) => {
    const receipt = await planFor("rerange", parseTokenId(tokenId, protocolFlag(opts)), cmd, { oorPercent: Number(opts.oor), protocol: protocolFlag(opts) });
    printReceipt(receipt);
    await maybeBroadcast(receipt, cmd);
  });

program
  .command("exit")
  .description("Exit the position")
  .argument("<tokenId>")
  .option("--price <n>", "trigger price token1/token0")
  .option("--swap-to <address>", "optional single-token exit")
  .option("--protocol <v>", "v2 | v3 | v4 (default v3)", "v3")
  .action(async (tokenId: string, opts, cmd) => {
    const receipt = await planFor("exit", parseTokenId(tokenId, protocolFlag(opts)), cmd, {
      exitPrice: opts.price ? Number(opts.price) : undefined,
      swapTo: opts.swapTo,
      protocol: protocolFlag(opts),
    });
    printReceipt(receipt);
    await maybeBroadcast(receipt, cmd);
  });

program
  .command("simulate")
  .description("Plan compound | range | exit. No broadcast.")
  .argument("<action>", "compound | range | exit")
  .argument("<tokenId>")
  .option("--protocol <v>", "v2 | v3 | v4 (default v3)", "v3")
  .action(async (action: string, tokenId: string, opts, cmd) => {
    const mapped = action === "range" || action === "rebalance" ? "rerange" : action;
    if (mapped !== "compound" && mapped !== "rerange" && mapped !== "exit") {
      throw new Error("action must be compound|range|exit");
    }
    const protocol = protocolFlag(opts);
    const receipt = await planFor(mapped, parseTokenId(tokenId, protocol), cmd, { protocol });
    printReceipt(receipt);
  });

program
  .command("run")
  .description("Keeper loop")
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
  .description("Chat. Live writes need yes.")
  .action(async (_opts, cmd) => {
    const rl = createInterface({ input, output });
    console.log(`UnaBot chat. ${PRODUCT_LINE} Type help or quit.`);
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
  .description("MCP stdio server")
  .action(async () => {
    await startMcpStdio();
  });

program
  .command("telegram")
  .description("Telegram. Live writes need yes.")
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
  .description("Print merged policy")
  .action(() => {
    console.log(JSON.stringify(loadConfig(), null, 2));
  });

async function connectRead(protocol: Protocol = "V3") {
  const env = loadEnv();
  const client = makePublicClient(env.rpcUrl);
  const adapter = adapterFor(protocol, client);
  return { env, client, adapter };
}

async function connect(ownerArg?: string, opts: { optional?: boolean; protocol?: Protocol } = {}) {
  const protocol = opts.protocol ?? "V3";
  const { env, client, adapter } = await connectRead(protocol);
  const account = loadAccount(env);
  const owner = ownerArg
    ? getAddress(ownerArg)
    : account?.address ?? (opts.optional ? getAddress("0x0000000000000000000000000000000000000001") : undefined);
  if (!owner) throw new Error("Pass --owner or set UNABOT_PRIVATE_KEY");
  adapter.bindOwner?.(owner);
  return { env, client, account, owner, adapter };
}

async function planFor(
  action: "compound" | "rerange" | "exit",
  tokenId: bigint,
  cmd: Command,
  extra: { oorPercent?: number; exitPrice?: number; swapTo?: string; protocol?: Protocol } = {},
) {
  const { adapter, owner, client, env } = await connect(undefined, { protocol: extra.protocol ?? "V3" });
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
    takeBps:
      action === "compound"
        ? COMPOUND_FEE_BPS
        : feeSourceFlag(program.opts()) === "notional"
          ? NOTIONAL_FEE_BPS
          : RANGE_EXIT_FEE_BPS,
    takeBaseUsd: feeSourceFlag(program.opts()) === "notional" ? usd.positionUsd : usd.feesUsd,
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
  const { hydrateCalldataMaybeApi } = await import("../core/hydrate.js");
  const { isPlaceholderTx, sendPlannedTx } = await import("../signer/broadcast.js");
  const { allowlistWithTokens } = await import("../signer/allowlist.js");
  const snap = await adapter.readPosition(receipt.tokenId);
  const filled = await hydrateCalldataMaybeApi(receipt, snap, owner, env.uniswapApiKey);
  const extra = allowlistWithTokens(snap.token0.address, snap.token1.address);
  for (const tx of filled.txs) {
    if (isPlaceholderTx(tx)) {
      console.log(`skip ${tx.description}: empty calldata (not broadcast)`);
      continue;
    }
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
    console.log(PRODUCT_HELP);
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

function protocolArgv(intent: Intent): string[] {
  return ["--protocol", protocolOf(intent).toLowerCase()];
}

async function dispatchIntent(intent: Intent): Promise<void> {
  const proto = protocolArgv(intent);
  switch (intent.verb) {
    case "list":
      await program.parseAsync(["node", "unabot", "list", ...proto, ...(intent.owner ? ["--owner", intent.owner] : [])]);
      break;
    case "status":
      if (intent.tokenId === undefined) {
        await program.parseAsync(["node", "unabot", "list", ...proto]);
      } else {
        await program.parseAsync(["node", "unabot", "status", String(intent.tokenId), ...proto]);
      }
      break;
    case "compound":
      await program.parseAsync(["node", "unabot", "compound", String(intent.tokenId), ...proto]);
      break;
    case "rerange":
      await program.parseAsync(["node", "unabot", "range", String(intent.tokenId), ...proto]);
      break;
    case "exit":
      await program.parseAsync(["node", "unabot", "exit", String(intent.tokenId), ...proto]);
      break;
    case "mint":
      console.log(JSON.stringify(intent, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
      console.log(`Use: unabot mint --protocol ${protocolOf(intent).toLowerCase()} --token0 <addr> --token1 <addr> --fee <n> --width <pct>`);
      break;
    case "simulate":
      if (!intent.action || intent.tokenId === undefined) {
        console.log("Use: unabot simulate compound|range|exit <tokenId> --protocol v3");
        break;
      }
      await program.parseAsync(["node", "unabot", "simulate", intent.action, String(intent.tokenId), ...proto]);
      break;
    default:
      break;
  }
}

export function buildProgram(): Command {
  return program;
}

export { PRODUCT_LINE, PRODUCT_HELP };

export { snapRange, rangeFromWidthPct, tickSpacingForFee };

const entry = process.argv[1] ?? "";
if (/unabot(\.(mjs|js))?$/.test(entry) || /cli\/index\.(js|ts)$/.test(entry)) {
  program.parseAsync(process.argv).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
