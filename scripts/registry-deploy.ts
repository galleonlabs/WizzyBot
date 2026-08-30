#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import {
  encodeDeployData,
  formatEther,
  getContractAddress,
  parseEther,
  type Abi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { addressesFor, chainOf } from "../src/chains.js";
import { loadEnv } from "../src/config/env.js";
import { makePublicClient, makeWalletClient } from "../src/signer/broadcast.js";

type RegistryArtifact = {
  abi: Abi;
  bytecode: { object: string };
};

const live = process.argv.includes("--live");
const env = loadEnv();
const chain = chainOf("robinhood");
const addresses = addressesFor("robinhood");
const artifact = JSON.parse(
  await readFile("contracts/out/UnaIndexRegistry.sol/UnaIndexRegistry.json", "utf8"),
) as RegistryArtifact;
const bytecode = normalizeBytecode(artifact.bytecode.object);
const configuredAccount = env.privateKey ? privateKeyToAccount(env.privateKey) : undefined;
const deployer = configuredAccount?.address ?? env.treasury;

if (deployer.toLowerCase() !== env.treasury.toLowerCase()) {
  throw new Error(`Registry deployer ${deployer} must match Una treasury ${env.treasury}`);
}

const publicClient = makePublicClient(env.rpcByChain.robinhood, chain.viem);
const constructorArgs = [deployer, deployer, addresses.factory, addresses.weth] as const;
const deploymentData = encodeDeployData({ abi: artifact.abi, bytecode, args: constructorArgs });
const [gas, gasPrice, balance, nonce] = await Promise.all([
  publicClient.estimateGas({
    account: deployer,
    data: deploymentData,
  }),
  publicClient.getGasPrice(),
  publicClient.getBalance({ address: deployer }),
  publicClient.getTransactionCount({ address: deployer, blockTag: "pending" }),
]);
const predictedAddress = getContractAddress({ from: deployer, nonce: BigInt(nonce) });
const estimatedCostWei = gas * gasPrice;
const recommendedFundingWei = estimatedCostWei * 2n > parseEther("0.001")
  ? estimatedCostWei * 2n
  : parseEther("0.001");
const preview = {
  live,
  chainId: chain.id,
  deployer,
  owner: deployer,
  curator: deployer,
  factory: addresses.factory,
  quoteToken: addresses.weth,
  predictedAddress,
  gas: gas.toString(),
  gasPriceWei: gasPrice.toString(),
  estimatedCostWei: estimatedCostWei.toString(),
  estimatedCostEth: formatEther(estimatedCostWei),
  balanceWei: balance.toString(),
  recommendedFundingWei: recommendedFundingWei.toString(),
  recommendedFundingEth: formatEther(recommendedFundingWei),
};

if (!live) {
  process.stdout.write(`${JSON.stringify({ ...preview, dryRun: true }, null, 2)}\n`);
  process.exit(0);
}
if (!configuredAccount) throw new Error("UNABOT_PRIVATE_KEY is required for --live");
if (balance < recommendedFundingWei) {
  throw new Error(`Fund ${deployer} with at least ${formatEther(recommendedFundingWei)} ETH before deployment`);
}
const predictedCode = await publicClient.getCode({ address: predictedAddress });
if (predictedCode && predictedCode !== "0x") {
  throw new Error(`Predicted registry address ${predictedAddress} already has code`);
}

const wallet = makeWalletClient(env.rpcByChain.robinhood, configuredAccount, chain.viem);
const hash = await wallet.deployContract({
  abi: artifact.abi,
  bytecode,
  args: constructorArgs,
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) {
  throw new Error(`Registry deployment ${hash} failed`);
}
if (receipt.contractAddress.toLowerCase() !== predictedAddress.toLowerCase()) {
  throw new Error(`Registry deployed at unexpected address ${receipt.contractAddress}`);
}
process.stdout.write(`${JSON.stringify({
  ...preview,
  dryRun: false,
  hash,
  contractAddress: receipt.contractAddress,
  blockNumber: receipt.blockNumber.toString(),
  gasUsed: receipt.gasUsed.toString(),
}, null, 2)}\n`);

function normalizeBytecode(value: string): Hex {
  const bytecode = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]+$/.test(bytecode) || bytecode === "0x") throw new Error("Registry artifact bytecode is missing");
  return bytecode as Hex;
}
