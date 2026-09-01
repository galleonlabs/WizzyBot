import type { PositionView } from "./cards.js";

export function positionValueUsd(position: PositionView): number | undefined {
  if (position.positionUsd !== undefined) return position.positionUsd;
  if (position.lpUsd === undefined) return undefined;
  return position.feesUsd === undefined ? position.lpUsd : Math.max(0, position.lpUsd - position.feesUsd);
}

/** Derive a quote-denominated value directly from the live NFT balances. */
export function positionValueEth(position: PositionView): number | undefined {
  return quoteValue(position.amount0, position.amount1, position.symbol0, position.symbol1, position.price);
}

export function positionFeesEth(position: PositionView): number | undefined {
  return quoteValue(position.uncollected0, position.uncollected1, position.symbol0, position.symbol1, position.price);
}

function quoteValue(amount0: string, amount1: string, symbol0: string, symbol1: string, price: number): number | undefined {
  const token0 = Number(amount0);
  const token1 = Number(amount1);
  if (!Number.isFinite(token0) || !Number.isFinite(token1) || token0 < 0 || token1 < 0 || !Number.isFinite(price) || price <= 0) return undefined;
  if (isEthQuote(symbol1)) return token1 + token0 * price;
  if (isEthQuote(symbol0)) return token0 + token1 / price;
  return undefined;
}

function isEthQuote(symbol: string): boolean {
  return symbol.toUpperCase() === "ETH" || symbol.toUpperCase() === "WETH";
}
