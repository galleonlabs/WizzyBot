import { encodeFunctionData, type Address, type PublicClient } from "viem";
import { addressesFor, slugOfClient } from "../chains.js";
import { poolAbi, factoryAbi } from "./abi.js";
import { rawToUsd } from "../core/pnl.js";
import type { PositionSnapshot } from "../types.js";

const quoterV2Abi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

export async function usdPricesForPosition(
  client: PublicClient,
  position: PositionSnapshot,
  ethUsdFallback?: number,
): Promise<{ price0Usd: number; price1Usd: number }> {
  const [p0, p1] = await Promise.all([
    tokenUsd(client, position.token0.address, position.token0.decimals, ethUsdFallback),
    tokenUsd(client, position.token1.address, position.token1.decimals, ethUsdFallback),
  ]);
  return { price0Usd: p0, price1Usd: p1 };
}

export async function tokenUsd(
  client: PublicClient,
  token: Address,
  decimals: number,
  ethUsdFallback?: number,
): Promise<number> {
  const addresses = addressesFor(slugOfClient(client));
  const weth = addresses.weth;
  const stableQuotes = [addresses.usdc, addresses.usdBc, addresses.usdg]
    .filter((address): address is Address => Boolean(address));
  if (stableQuotes.some((quote) => token.toLowerCase() === quote.toLowerCase())) return 1;

  for (const quote of stableQuotes) {
    const viaStable = await midPriceUsd(client, addresses.factory, token, decimals, quote, 6);
    if (viaStable !== undefined) return viaStable;
  }

  if (token.toLowerCase() === weth.toLowerCase() || token.toLowerCase() === addresses.nativeEth.toLowerCase()) {
    return ethUsdFallback ?? 0;
  }

  const viaWeth = await midPriceUsd(client, addresses.factory, token, decimals, weth, 18);
  if (viaWeth !== undefined) {
    const wethUsd = await tokenUsd(client, weth, 18, ethUsdFallback);
    return viaWeth * wethUsd;
  }
  return 0;
}

async function midPriceUsd(
  client: PublicClient,
  factory: Address,
  token: Address,
  tokenDecimals: number,
  quote: Address,
  quoteDecimals: number,
): Promise<number | undefined> {
  for (const fee of [500, 3000, 100, 10000]) {
    try {
      const pool = await client.readContract({
        address: factory,
        abi: factoryAbi,
        functionName: "getPool",
        args: [token, quote, fee],
      });
      if (pool === "0x0000000000000000000000000000000000000000") continue;
      const [slot0, token0] = await Promise.all([
        client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
        client.readContract({ address: pool, abi: poolAbi, functionName: "token0" }),
      ]);
      const sqrt = Number(slot0[0]) / 2 ** 96;
      const priceToken1PerToken0 = sqrt * sqrt;
      const tokenIs0 = token.toLowerCase() === token0.toLowerCase();
      const raw = tokenIs0 ? priceToken1PerToken0 : 1 / priceToken1PerToken0;
      const adj = raw * 10 ** (tokenDecimals - quoteDecimals);
      if (Number.isFinite(adj) && adj > 0) return adj;
    } catch {
      continue;
    }
  }
  return undefined;
}

export function snapshotUsd(
  position: PositionSnapshot,
  price0Usd: number,
  price1Usd: number,
): { amount0Usd: number; amount1Usd: number; feesUsd: number; positionUsd: number } {
  const amount0Usd = rawToUsd(position.amount0, position.token0.decimals, price0Usd);
  const amount1Usd = rawToUsd(position.amount1, position.token1.decimals, price1Usd);
  const feesUsd =
    rawToUsd(position.uncollected0, position.token0.decimals, price0Usd) +
    rawToUsd(position.uncollected1, position.token1.decimals, price1Usd);
  return {
    amount0Usd,
    amount1Usd,
    feesUsd,
    positionUsd: amount0Usd + amount1Usd,
  };
}

export function encodeQuoteCall(tokenIn: Address, tokenOut: Address, amountIn: bigint, fee: number): `0x${string}` {
  return encodeFunctionData({
    abi: quoterV2Abi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn,
        tokenOut,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
}
