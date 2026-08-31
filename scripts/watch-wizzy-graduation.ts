#!/usr/bin/env bun
/**
 * Graduation watcher. Polls the Robinhood Uniswap v3 factory for the
 * WIZZY/WETH pool and reports the moment the launchpad seeds it. Read-only;
 * intended for a dappnode timer. Alerts once per state change via
 * UNABOT_ALERT_WEBHOOK when set.
 *
 *   WIZZY_TOKEN_ADDRESS=0x... bun scripts/watch-wizzy-graduation.ts
 *   bun scripts/watch-wizzy-graduation.ts --token=0x... [--state-dir=~/.local/state/unabot-curator]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createPublicClient, getAddress, http, isAddress, parseAbi, zeroAddress } from "viem";
import { addressesFor, viemChainFor } from "../src/chains.js";
import { loadEnv } from "../src/config/env.js";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const tokenArg = argument("token") ?? process.env.WIZZY_TOKEN_ADDRESS;
if (!tokenArg || !isAddress(tokenArg)) {
  console.log(JSON.stringify({ status: "disarmed", reason: "set WIZZY_TOKEN_ADDRESS or pass --token=0x..." }));
  process.exit(0);
}
const token = getAddress(tokenArg);
const stateDir = argument("state-dir")
  ?? process.env.UNABOT_CURATOR_STATE_DIR
  ?? join(process.env.HOME ?? "", ".local/state/unabot-curator");
const statePath = join(stateDir, "wizzy-graduation.json");

const env = loadEnv();
const addresses = addressesFor("robinhood");
const client = createPublicClient({ chain: viemChainFor("robinhood"), transport: http(env.rpcByChain.robinhood) });
const factoryAbi = parseAbi(["function getPool(address, address, uint24) view returns (address)"]);
const poolAbi = parseAbi([
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
]);

type Found = { fee: number; pool: string; liquidity: string; sqrtPriceX96: string };
let found: Found | null = null;
for (const fee of [10_000, 3_000, 500]) {
  const pool = await client.readContract({
    address: addresses.factory,
    abi: factoryAbi,
    functionName: "getPool",
    args: [token, addresses.weth, fee],
  });
  if (pool === zeroAddress) continue;
  const [liquidity, slot0] = await Promise.all([
    client.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" }),
    client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
  ]);
  found = { fee, pool, liquidity: liquidity.toString(), sqrtPriceX96: slot0[0].toString() };
  if (liquidity > 0n) break;
}

const status = !found ? "waiting" : BigInt(found.liquidity) > 0n ? "graduated" : "pool-created";
const report = { status, token, ...(found ?? {}), checkedAt: new Date().toISOString() };
console.log(JSON.stringify(report));

let previousStatus: string | undefined;
try {
  previousStatus = (JSON.parse((await readFile(statePath)).toString("utf8")) as { status?: string }).status;
} catch {
  previousStatus = undefined;
}
await mkdir(stateDir, { recursive: true, mode: 0o700 });
await writeFile(statePath, `${JSON.stringify(report)}\n`, { mode: 0o600 });

if (status !== previousStatus && status !== "waiting" && env.alertWebhook) {
  const line = status === "graduated"
    ? `WIZZY graduated: ${found!.pool} (fee ${found!.fee}, liquidity ${found!.liquidity}). Run docs/GRADUATION.md.`
    : `WIZZY/WETH pool created at ${found!.pool} (fee ${found!.fee}) but liquidity is still zero.`;
  // Discord reads `content`, Slack-style receivers read `text`; each ignores
  // the other key, so one payload serves both webhook dialects.
  await fetch(env.alertWebhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: line, text: line }),
  }).catch(() => undefined);
}
