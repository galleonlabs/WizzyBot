#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainOf } from "../src/chains.js";
import { loadEnv } from "../src/config/env.js";
import type { CuratorReport } from "../src/curator/run.js";
import { planAutonomousRobinhoodRegistry } from "../src/index/autonomous.js";
import { encodeRegistryPublish } from "../src/index/publish.js";
import { readIndexRegistry, unaIndexRegistryAbi } from "../src/index/registry.js";
import { makePublicClient, makeWalletClient } from "../src/signer/broadcast.js";

function argument(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const reportPath = argument("--report") ?? `${process.env.UNABOT_CURATOR_STATE_DIR ?? `${process.env.HOME}/.local/state/unabot-curator`}/latest.json`;
const evidenceURI = argument("--evidence-uri") ?? "";
const live = process.argv.includes("--live");
const env = loadEnv();
if (!env.indexRegistryAddress) throw new Error("UNA_INDEX_REGISTRY_ADDRESS is required");
if (evidenceURI.length > 200) throw new Error("Evidence URI exceeds the registry's 200-byte limit");

const reportBytes = await readFile(reportPath);
const report = JSON.parse(reportBytes.toString("utf8")) as CuratorReport;
const chain = chainOf("robinhood");
const publicClient = makePublicClient(env.rpcByChain.robinhood, chain.viem);
const snapshot = await readIndexRegistry(publicClient, env.indexRegistryAddress);
const plan = planAutonomousRobinhoodRegistry({ report, currentMarkets: snapshot.markets });
const evidenceHash = keccak256(toHex(reportBytes));
const [owner, curator] = await Promise.all([
  publicClient.readContract({
    address: env.indexRegistryAddress,
    abi: unaIndexRegistryAbi,
    functionName: "owner",
  }) as Promise<Address>,
  publicClient.readContract({
    address: env.indexRegistryAddress,
    abi: unaIndexRegistryAbi,
    functionName: "curator",
  }) as Promise<Address>,
]);
if (owner.toLowerCase() !== curator.toLowerCase()) {
  throw new Error(`Registry owner ${owner} and curator ${curator} must be the same Una signer`);
}
if (owner.toLowerCase() !== env.treasury.toLowerCase()) {
  throw new Error(`Registry signer ${owner} must match Una treasury ${env.treasury}`);
}

if (plan.kind === "noop" || (plan.kind === "pause" && snapshot.paused)) {
  if (plan.kind === "noop" && snapshot.paused) {
    // A clean, fresh curator report is the recovery condition. The owner and curator
    // are deliberately the same autonomous signer for Una's current operating model.
  } else {
    process.stdout.write(`${JSON.stringify({ live, action: "noop", reason: plan.reason, registry: snapshot.address, version: snapshot.version }, null, 2)}\n`);
    process.exit(0);
  }
}

const shouldUnpause = snapshot.paused && plan.kind !== "pause";
const shouldPause = plan.kind === "pause" && !snapshot.paused;
const shouldPublish = plan.kind === "publish";
const actions = [
  ...(shouldUnpause ? ["unpause"] : []),
  ...(shouldPause ? ["pause"] : []),
  ...(shouldPublish ? ["publish"] : []),
] as Array<"unpause" | "pause" | "publish">;

if (actions.length === 0) {
  process.stdout.write(`${JSON.stringify({ live, action: "noop", reason: plan.reason, registry: snapshot.address, version: snapshot.version }, null, 2)}\n`);
  process.exit(0);
}

const preview = {
  live,
  actions,
  reason: plan.reason,
  registry: snapshot.address,
  expectedVersion: snapshot.version,
  evidenceHash,
  marketCount: plan.kind === "publish" ? plan.markets.length : snapshot.markets.length,
  owner,
  curator,
};
if (!live) {
  const data = plan.kind === "publish"
    ? encodeRegistryPublish({ expectedVersion: BigInt(snapshot.version), markets: plan.markets, evidenceHash, evidenceURI })
    : undefined;
  if (!(shouldUnpause && shouldPublish)) {
    await simulate(actions[0]!);
  }
  process.stdout.write(`${JSON.stringify({
    ...preview,
    dryRun: true,
    data,
    simulation: shouldUnpause && shouldPublish ? "publish simulation follows the unpause receipt" : "passed",
  }, null, 2)}\n`);
  process.exit(0);
}

if (!env.privateKey) throw new Error("UNABOT_PRIVATE_KEY is required for --live");
const account = privateKeyToAccount(env.privateKey);
if (account.address.toLowerCase() !== owner.toLowerCase()) {
  throw new Error(`Configured signer ${account.address} is not registry owner and curator ${owner}`);
}
const wallet = makeWalletClient(env.rpcByChain.robinhood, account, chain.viem);
const transactions: Array<{ action: string; hash: Hex; blockNumber: string }> = [];
for (const action of actions) {
  await simulate(action);
  const request = contractCall(action);
  const hash = await wallet.writeContract({
    address: env.indexRegistryAddress,
    abi: unaIndexRegistryAbi,
    functionName: request.functionName,
    args: request.args as never,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Registry ${action} transaction ${hash} reverted`);
  transactions.push({ action, hash, blockNumber: receipt.blockNumber.toString() });
}
process.stdout.write(`${JSON.stringify({ ...preview, dryRun: false, transactions }, null, 2)}\n`);

function contractCall(action: "unpause" | "pause" | "publish") {
  if (action === "unpause") return { functionName: "unpause" as const, args: [] as const };
  if (action === "pause") {
    if (plan.kind !== "pause") throw new Error("Pause action is missing its curator reason");
    return { functionName: "pause" as const, args: [plan.reasonHash] as const };
  }
  if (plan.kind !== "publish") throw new Error("Publish action is missing its curator snapshot");
  return {
    functionName: "publish" as const,
    args: [BigInt(snapshot.version), plan.markets, evidenceHash, evidenceURI] as const,
  };
}

async function simulate(action: "unpause" | "pause" | "publish") {
  const request = contractCall(action);
  await publicClient.simulateContract({
    address: env.indexRegistryAddress!,
    abi: unaIndexRegistryAbi,
    functionName: request.functionName,
    args: request.args as never,
    account: owner,
  });
}
