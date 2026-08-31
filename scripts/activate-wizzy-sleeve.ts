#!/usr/bin/env bun
/**
 * One-command Stage 3 sleeve activation (docs/TOKEN_FLYWHEEL.md,
 * docs/GRADUATION.md). Rewrites src/config/markets.json so the Wizzy token
 * joins the Robinhood index as the fixed related-party sleeve and the
 * ordinary constituents share the remainder. Config-only: no transaction,
 * signature, or fee-routing change happens here.
 *
 *   bun scripts/activate-wizzy-sleeve.ts --token=0x... --pool=0x... [--fee=10000] [--weight-bps=500] [--skip-chain-check]
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createPublicClient, getAddress, http, isAddress, parseAbi } from "viem";
import { addressesFor, viemChainFor } from "../src/chains.js";
import { loadEnv } from "../src/config/env.js";
import { parseMarketCatalog } from "../src/markets/catalog.js";

const TICK_SPACING_BY_FEE = new Map<number, number>([[100, 1], [500, 10], [3_000, 60], [10_000, 200]]);

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const tokenArg = argument("token");
const poolArg = argument("pool");
if (!tokenArg || !isAddress(tokenArg) || !poolArg || !isAddress(poolArg)) {
  throw new Error("Pass --token=0x... and --pool=0x... (the graduated WIZZY/WETH Uniswap v3 pool)");
}
const token = getAddress(tokenArg);
const pool = getAddress(poolArg);
const fee = Number(argument("fee") ?? 10_000);
const weightBps = Number(argument("weight-bps") ?? 500);
const tickSpacing = TICK_SPACING_BY_FEE.get(fee);
if (!tickSpacing) throw new Error(`Unsupported fee tier ${fee}`);
if (!Number.isSafeInteger(weightBps) || weightBps <= 0 || weightBps > 1_000) {
  throw new Error("Sleeve weight must be 1-1000 bps (10% hard maximum)");
}

const addresses = addressesFor("robinhood");

if (!process.argv.includes("--skip-chain-check")) {
  const env = loadEnv();
  const client = createPublicClient({ chain: viemChainFor("robinhood"), transport: http(env.rpcByChain.robinhood) });
  const abi = parseAbi([
    "function token0() view returns (address)",
    "function token1() view returns (address)",
    "function fee() view returns (uint24)",
    "function liquidity() view returns (uint128)",
  ]);
  const [token0, token1, poolFee, liquidity] = await Promise.all([
    client.readContract({ address: pool, abi, functionName: "token0" }),
    client.readContract({ address: pool, abi, functionName: "token1" }),
    client.readContract({ address: pool, abi, functionName: "fee" }),
    client.readContract({ address: pool, abi, functionName: "liquidity" }),
  ]);
  const pair = new Set([getAddress(token0), getAddress(token1)]);
  if (!pair.has(token) || !pair.has(getAddress(addresses.weth))) {
    throw new Error(`Pool ${pool} is not the ${token}/WETH pair (token0=${token0}, token1=${token1})`);
  }
  if (Number(poolFee) !== fee) throw new Error(`Pool fee ${poolFee} does not match --fee=${fee}`);
  if (liquidity === 0n) throw new Error("Pool has zero liquidity; activate only after graduation seeds real liquidity");
  console.log(`verified onchain: ${token}/WETH fee=${fee} liquidity=${liquidity}`);
}

const catalogPath = "src/config/markets.json";
const catalog = JSON.parse((await readFile(catalogPath)).toString("utf8"));
const robinhood = catalog.chains.find((chain: { slug: string }) => chain.slug === "robinhood");
if (!robinhood) throw new Error("Robinhood catalog is missing");
if (robinhood.markets.some((market: { sleeve?: boolean }) => market.sleeve)) {
  throw new Error("A related-party sleeve already exists; expansion or replacement is a separate reviewed release");
}
const actives = robinhood.markets.filter((market: { status: string }) => market.status === "active");
if (!actives.length) throw new Error("No active ordinary constituents to rescale");

// Rescale ordinaries to share the remainder, largest-remainder rounding.
const target = 10_000 - weightBps;
const total = actives.reduce((sum: number, market: { weightBps: number }) => sum + market.weightBps, 0);
const shares = actives.map((market: { id: string; weightBps: number }) => {
  const exact = (market.weightBps * target) / total;
  return { market, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
});
let leftover = target - shares.reduce((sum: number, share: { floor: number }) => sum + share.floor, 0);
shares.sort((a: { remainder: number; market: { id: string } }, b: { remainder: number; market: { id: string } }) =>
  b.remainder - a.remainder || a.market.id.localeCompare(b.market.id));
for (const share of shares) {
  share.market.weightBps = share.floor + (leftover > 0 ? 1 : 0);
  leftover -= leftover > 0 ? 1 : 0;
}

const template = actives[0];
robinhood.markets.push({
  id: "robinhood-wizzy",
  name: "Wizzy",
  symbol: "WIZZY",
  token,
  tokenDecimals: 18,
  quoteToken: template.quoteToken,
  quoteSymbol: template.quoteSymbol,
  quoteDecimals: template.quoteDecimals,
  protocol: "V3",
  pool,
  fee,
  tickSpacing,
  rangeWidthPct: template.rangeWidthPct,
  weightBps,
  status: "active",
  risk: "experimental",
  sleeve: true,
  color: "#f7a8b8",
});
catalog.version += 1;
catalog.updatedAt = new Date().toISOString().slice(0, 10);

const parsed = parseMarketCatalog(catalog);
const activeSum = parsed.chains
  .find((chain) => chain.slug === "robinhood")!
  .markets.filter((market) => market.status === "active")
  .reduce((sum, market) => sum + market.weightBps, 0);
if (activeSum !== 10_000) throw new Error(`Active weights sum to ${activeSum}, expected 10,000`);

const temporary = `${catalogPath}.${process.pid}.tmp`;
await mkdir(dirname(catalogPath), { recursive: true });
await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o644 });
await rename(temporary, catalogPath);
console.log(JSON.stringify({
  activated: "robinhood-wizzy",
  weightBps,
  ordinaries: parsed.chains.find((chain) => chain.slug === "robinhood")!.markets
    .filter((market) => market.status === "active" && !market.sleeve)
    .map((market) => ({ id: market.id, weightBps: market.weightBps })),
  next: "run the full gate (bun test, typecheck, build:web), review the diff, then ship via the normal release path",
}, null, 2));
