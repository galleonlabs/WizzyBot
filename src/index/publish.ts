import { encodeFunctionData, stringToHex, type Address, type Hex } from "viem";
import { activeMarkets } from "../markets/catalog.js";
import { unaIndexRegistryAbi } from "./registry.js";

export type RegistryPublishMarket = {
  id: Hex;
  token: Address;
  pool: Address;
  weightBps: number;
  fee: number;
  tickSpacing: number;
  rangeWidthBps: number;
};

export function initialRobinhoodRegistryMarkets(): RegistryPublishMarket[] {
  return activeMarkets("robinhood")
    .slice()
    .sort((a, b) => b.weightBps - a.weightBps || a.id.localeCompare(b.id))
    .map((market) => ({
      id: stringToHex(market.id, { size: 32 }),
      token: market.token,
      pool: market.pool,
      weightBps: market.weightBps,
      fee: market.fee,
      tickSpacing: market.tickSpacing,
      rangeWidthBps: Math.round(market.rangeWidthPct * 100),
    }));
}

export function encodeRegistryPublish(input: {
  expectedVersion: bigint;
  evidenceHash: Hex;
  evidenceURI?: string;
  markets?: RegistryPublishMarket[];
}): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.evidenceHash) || /^0x0{64}$/.test(input.evidenceHash)) {
    throw new Error("evidenceHash must be a nonzero bytes32 value");
  }
  const markets = input.markets ?? initialRobinhoodRegistryMarkets();
  if (markets.reduce((sum, market) => sum + market.weightBps, 0) !== 10_000) {
    throw new Error("registry market weights must total 10,000 bps");
  }
  return encodeFunctionData({
    abi: unaIndexRegistryAbi,
    functionName: "publish",
    args: [input.expectedVersion, markets, input.evidenceHash, input.evidenceURI ?? ""],
  });
}

