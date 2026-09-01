import type { PublicClient } from "viem";
import { slipstreamPoolAbi } from "../aerodrome/abi.js";
import { addressesFor, slugOfClient } from "../chains.js";
import { poolAbi, v4StateViewAbi } from "../chain/abi.js";
import type { PositionSnapshot } from "../types.js";

const MAX_BITMAP_WORDS = 12;
const MAX_INITIALIZED_TICKS = 192;
const TARGET_BINS = 48;

export type LiquidityProfileBin = {
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  height: number;
};

export type LiquidityProfile = {
  source: "live";
  protocol: "V3" | "V4";
  venue: "uniswap-v3" | "aerodrome-slipstream" | "uniswap-v4";
  tickCurrent: number;
  tickSpacing: number;
  tickLower: number;
  tickUpper: number;
  complete: boolean;
  notice?: string;
  bins: LiquidityProfileBin[];
};

export function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

export function initializedTicksFromBitmap(wordPosition: number, bitmap: bigint, tickSpacing: number): number[] {
  const ticks: number[] = [];
  for (let bit = 0; bit < 256; bit++) {
    if ((bitmap & (1n << BigInt(bit))) !== 0n) {
      ticks.push((wordPosition * 256 + bit) * tickSpacing);
    }
  }
  return ticks;
}

export function buildLiquidityBins(input: {
  activeLiquidity: bigint;
  tickCurrent: number;
  tickSpacing: number;
  tickLower: number;
  tickUpper: number;
  liquidityNet: ReadonlyMap<number, bigint>;
  binCount?: number;
}): LiquidityProfileBin[] {
  const lowerCompressed = floorDiv(input.tickLower, input.tickSpacing);
  const upperCompressed = Math.ceil(input.tickUpper / input.tickSpacing);
  const compressedSpan = Math.max(1, upperCompressed - lowerCompressed);
  const compressedPerBin = Math.max(1, Math.ceil(compressedSpan / (input.binCount ?? TARGET_BINS)));
  const initialized = [...input.liquidityNet.entries()].sort(([a], [b]) => a - b);

  const liquidityAt = (targetTick: number): bigint => {
    let liquidity = input.activeLiquidity;
    if (targetTick > input.tickCurrent) {
      for (const [tick, net] of initialized) {
        if (tick > input.tickCurrent && tick <= targetTick) liquidity += net;
      }
    } else if (targetTick < input.tickCurrent) {
      for (const [tick, net] of initialized) {
        if (tick <= input.tickCurrent && tick > targetTick) liquidity -= net;
      }
    }
    return liquidity > 0n ? liquidity : 0n;
  };

  const raw: Array<{ tickLower: number; tickUpper: number; liquidity: bigint }> = [];
  for (let compressed = lowerCompressed; compressed < upperCompressed; compressed += compressedPerBin) {
    const end = Math.min(upperCompressed, compressed + compressedPerBin);
    const tickLower = compressed * input.tickSpacing;
    const tickUpper = end * input.tickSpacing;
    const midpoint = Math.floor((tickLower + tickUpper) / 2);
    raw.push({ tickLower, tickUpper, liquidity: liquidityAt(midpoint) });
  }
  const max = raw.reduce((highest, bin) => bin.liquidity > highest ? bin.liquidity : highest, 0n);
  return raw.map((bin) => ({
    tickLower: bin.tickLower,
    tickUpper: bin.tickUpper,
    liquidity: bin.liquidity.toString(),
    height: max === 0n ? 0 : Number((bin.liquidity * 1000n) / max) / 1000,
  }));
}

function chartDomain(position: PositionSnapshot): {
  tickLower: number;
  tickUpper: number;
  words: number[];
  complete: boolean;
} {
  const spacing = Math.abs(position.tickSpacing) || 1;
  const positionSpan = Math.max(spacing, position.tickUpper - position.tickLower);
  const padding = Math.max(spacing * 16, Math.ceil(positionSpan * 0.18 / spacing) * spacing);
  const wantedLower = Math.min(position.tickLower, position.tickCurrent) - padding;
  const wantedUpper = Math.max(position.tickUpper, position.tickCurrent) + padding;
  const wantedFirstWord = floorDiv(floorDiv(wantedLower, spacing), 256);
  const wantedLastWord = floorDiv(floorDiv(wantedUpper, spacing), 256);
  const wantedWordCount = wantedLastWord - wantedFirstWord + 1;

  let firstWord = wantedFirstWord;
  let lastWord = wantedLastWord;
  const complete = wantedWordCount <= MAX_BITMAP_WORDS;
  if (!complete) {
    const currentWord = floorDiv(floorDiv(position.tickCurrent, spacing), 256);
    firstWord = currentWord - Math.floor(MAX_BITMAP_WORDS / 2);
    lastWord = firstWord + MAX_BITMAP_WORDS - 1;
  }
  return {
    tickLower: firstWord * 256 * spacing,
    tickUpper: (lastWord + 1) * 256 * spacing,
    words: Array.from({ length: lastWord - firstWord + 1 }, (_, index) => firstWord + index),
    complete,
  };
}

export async function readLiquidityProfile(
  client: PublicClient,
  position: PositionSnapshot,
): Promise<LiquidityProfile | undefined> {
  if (position.ref.protocol === "V2" || position.tickSpacing <= 0) return undefined;
  const domain = chartDomain(position);
  const isV4 = position.ref.protocol === "V4";
  const isSlipstream = position.venue === "aerodrome-slipstream";
  const stateView = addressesFor(slugOfClient(client)).v4StateView;
  if (isV4 && !position.poolId) return undefined;

  const activeLiquidityPromise = isV4
    ? client.readContract({ address: stateView, abi: v4StateViewAbi, functionName: "getLiquidity", args: [position.poolId!] })
    : client.readContract({
        address: position.pool,
        abi: isSlipstream ? slipstreamPoolAbi : poolAbi,
        functionName: "liquidity",
      });
  const bitmapsPromise = Promise.all(domain.words.map((word) => isV4
    ? client.readContract({ address: stateView, abi: v4StateViewAbi, functionName: "getTickBitmap", args: [position.poolId!, word] })
    : client.readContract({
        address: position.pool,
        abi: isSlipstream ? slipstreamPoolAbi : poolAbi,
        functionName: "tickBitmap",
        args: [word],
      })));
  const [activeLiquidity, bitmaps] = await Promise.all([activeLiquidityPromise, bitmapsPromise]);
  const initializedTicks = bitmaps.flatMap((bitmap, index) =>
    initializedTicksFromBitmap(domain.words[index]!, bitmap, position.tickSpacing),
  ).filter((tick) => tick >= domain.tickLower && tick <= domain.tickUpper);
  if (initializedTicks.length > MAX_INITIALIZED_TICKS) return undefined;

  const tickStates = await Promise.all(initializedTicks.map(async (tick) => {
    const state = isV4
      ? await client.readContract({
          address: stateView,
          abi: v4StateViewAbi,
          functionName: "getTickLiquidity",
          args: [position.poolId!, tick],
        })
      : await client.readContract({
          address: position.pool,
          abi: isSlipstream ? slipstreamPoolAbi : poolAbi,
          functionName: "ticks",
          args: [tick],
        });
    return [tick, state[1]] as const;
  }));
  const liquidityNet = new Map<number, bigint>(tickStates);
  return {
    source: "live",
    protocol: position.ref.protocol,
    venue: isV4 ? "uniswap-v4" : isSlipstream ? "aerodrome-slipstream" : "uniswap-v3",
    tickCurrent: position.tickCurrent,
    tickSpacing: position.tickSpacing,
    tickLower: domain.tickLower,
    tickUpper: domain.tickUpper,
    complete: domain.complete,
    notice: domain.complete ? undefined : "Showing live liquidity around the current price.",
    bins: buildLiquidityBins({
      activeLiquidity,
      tickCurrent: position.tickCurrent,
      tickSpacing: position.tickSpacing,
      tickLower: domain.tickLower,
      tickUpper: domain.tickUpper,
      liquidityNet,
    }),
  };
}
