import { describe, expect, it } from "vitest";
import { TickMath } from "@uniswap/v3-sdk";
import { getAddress, type Address } from "viem";
import { addressesFor, chainOf, type ChainSlug } from "../src/chains.js";
import { planMint, quoteMintFromPool, quoteMintV2 } from "../src/core/mint.js";
import { adapterFor, v2WatchPairsFor } from "../src/core/protocols.js";
import { chainCatalog, type CuratedMarket } from "../src/markets/catalog.js";
import { buildPositionActionPlan, buildRebalancePositionActionPlan, positionPoolIsConfigured } from "../src/portfolio/position-actions.js";
import { TREASURY } from "../src/constants.js";
import type { PositionSnapshot, Protocol, TokenRef } from "../src/types.js";

const owner = getAddress("0x1111111111111111111111111111111111111111");
const chains = ["base", "robinhood"] as const;
const protocols = ["V2", "V3", "V4"] as const;

describe("Base and Robinhood protocol parity", () => {
  for (const chain of chains) {
    for (const protocol of protocols) {
      it(`${chain} ${protocol} can create and discover self-custodied positions`, () => {
        const market = marketFor(chain, protocol);
        const addresses = addressesFor(chain);
        const quote = mintQuote(chain, protocol, market);
        const receipt = planMint(quote, owner, true);
        const expectedTarget = protocol === "V2"
          ? addresses.v2Router
          : protocol === "V4"
            ? addresses.v4PositionManager
            : addresses.nfpm;
        expect(receipt.skipped).toBe(false);
        expect(receipt.txs.some((transaction) => transaction.to === expectedTarget && transaction.data !== "0x")).toBe(true);
        expect(adapterFor(protocol, {} as never).protocol).toBe(protocol);
        expect(positionPoolIsConfigured(snapshot(chain, protocol, market), chainCatalog(chain).markets)).toBe(true);
        if (protocol === "V2") {
          const watched = v2WatchPairsFor(chain).map((pair) => new Set(pair.map((address) => address.toLowerCase())));
          expect(watched.some((pair) => pair.has(market.token.toLowerCase()) && pair.has(market.quoteToken.toLowerCase()))).toBe(true);
        }
      });

      it(`${chain} ${protocol} has protocol-correct fee and withdrawal management`, () => {
        const market = marketFor(chain, protocol);
        const position = snapshot(chain, protocol, market);
        const addresses = addressesFor(chain);
        if (protocol === "V2") {
          expect(() => buildPositionActionPlan(position, owner, chain, "collect", TREASURY)).toThrow("already reinvested");
          expect(() => buildPositionActionPlan(position, owner, chain, "compound", TREASURY)).toThrow("already reinvested");
          expect(() => buildRebalancePositionActionPlan({ ...position, inRange: false }, owner, chain, TREASURY)).toThrow("already full range");
          const withdraw = buildPositionActionPlan(position, owner, chain, "withdraw", TREASURY);
          expect(withdraw.transactions.some((transaction) => transaction.to === addresses.v2Router)).toBe(true);
          return;
        }

        const collect = buildPositionActionPlan(position, owner, chain, "collect", TREASURY);
        const compound = buildPositionActionPlan(position, owner, chain, "compound", TREASURY);
        const withdraw = buildPositionActionPlan(position, owner, chain, "withdraw", TREASURY);
        const outOfRange = snapshot(chain, protocol, market, true);
        const rebalance = buildRebalancePositionActionPlan(outOfRange, owner, chain, TREASURY);
        const manager = protocol === "V4" ? addresses.v4PositionManager : addresses.nfpm;
        expect(collect.serviceFeeBps).toBe(0);
        expect(collect.transactions.some((transaction) => transaction.to === manager)).toBe(true);
        expect(compound.transactions.some((transaction) => transaction.to === manager)).toBe(true);
        expect(withdraw.transactions.some((transaction) => transaction.to === manager)).toBe(true);
        expect(rebalance.transactions.some((transaction) => transaction.to === manager)).toBe(true);
        expect([collect, compound, withdraw, rebalance].flatMap((plan) => plan.transactions).every((transaction) => transaction.data !== "0x" || BigInt(transaction.value) > 0n)).toBe(true);
      });
    }
  }
});

function marketFor(chain: ChainSlug, protocol: Protocol): CuratedMarket {
  const market = chainCatalog(chain).markets.find((candidate) => {
    if (candidate.status !== "active") return false;
    if (protocol === "V3") return candidate.protocol === "V3";
    return candidate.liquidityVenues.some((venue) => venue.protocol === protocol);
  });
  if (!market) throw new Error(`Missing active ${chain} ${protocol} market`);
  return market;
}

function orderedTokens(chain: ChainSlug, market: CuratedMarket): [TokenRef, TokenRef] {
  const quote: TokenRef = { address: market.quoteToken, symbol: market.quoteSymbol, decimals: market.quoteDecimals };
  const meme: TokenRef = { address: market.token, symbol: market.symbol, decimals: market.tokenDecimals };
  return quote.address.toLowerCase() < meme.address.toLowerCase() ? [quote, meme] : [meme, quote];
}

function mintQuote(chain: ChainSlug, protocol: Protocol, market: CuratedMarket) {
  const chainId = chainOf(chain).id;
  const [token0, token1] = orderedTokens(chain, market);
  if (protocol === "V2") {
    const venue = market.liquidityVenues.find((candidate) => candidate.protocol === "V2")!;
    return quoteMintV2({
      chainId,
      token0,
      token1,
      reserve0: 10n ** 21n,
      reserve1: 10n ** 21n,
      pool: venue.pool,
      amount0Desired: 10n ** 18n,
      amount1Desired: 10n ** 18n,
    });
  }
  const addresses = addressesFor(chain);
  const venue = protocol === "V4" ? market.liquidityVenues.find((candidate) => candidate.protocol === "V4") : undefined;
  return {
    ...quoteMintFromPool({
      chainId,
      protocol,
      token0,
      token1,
      fee: venue?.fee ?? market.fee,
      tickSpacing: venue?.tickSpacing ?? market.tickSpacing,
      sqrtPriceX96: 2n ** 96n,
      tickCurrent: 0,
      pool: protocol === "V4" ? addresses.v4PoolManager : market.pool,
      widthPct: market.rangeWidthPct,
      amount0Desired: 10n ** 18n,
      amount1Desired: 10n ** 18n,
    }),
    ...(protocol === "V4" ? { hooks: venue && "hooks" in venue ? venue.hooks : addresses.nativeEth } : {}),
  };
}

function snapshot(chain: ChainSlug, protocol: Protocol, market: CuratedMarket, outOfRange = false): PositionSnapshot {
  const chainId = chainOf(chain).id;
  const addresses = addressesFor(chain);
  const [token0, token1] = orderedTokens(chain, market);
  const v2 = market.liquidityVenues.find((candidate) => candidate.protocol === "V2");
  const v4 = market.liquidityVenues.find((candidate) => candidate.protocol === "V4");
  const spacing = protocol === "V4" && v4 && "tickSpacing" in v4 ? v4.tickSpacing : market.tickSpacing;
  const lower = -2 * spacing;
  const upper = 2 * spacing;
  const current = outOfRange ? 4 * spacing : 0;
  const pool: Address = protocol === "V2" && v2 && "pool" in v2
    ? v2.pool
    : protocol === "V4"
      ? addresses.v4PoolManager
      : market.pool;
  return {
    ref: { protocol, chainId, tokenId: protocol === "V2" ? BigInt(pool) : 77n },
    owner,
    token0,
    token1,
    fee: protocol === "V4" && v4 && "fee" in v4 ? v4.fee : market.fee,
    tickSpacing: spacing,
    tickLower: protocol === "V2" ? -887_272 : lower,
    tickUpper: protocol === "V2" ? 887_272 : upper,
    tickCurrent: current,
    sqrtPriceX96: BigInt(TickMath.getSqrtRatioAtTick(current).toString()),
    liquidity: 10n ** 18n,
    tokensOwed0: 0n,
    tokensOwed1: 0n,
    uncollected0: 10n ** 17n,
    uncollected1: 10n ** 17n,
    amount0: 10n ** 18n,
    amount1: 10n ** 18n,
    inRange: protocol === "V2" || !outOfRange,
    percentThroughRange: outOfRange ? 100 : 50,
    pool,
  };
}
