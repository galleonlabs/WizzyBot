import type { PositionView } from "./cards.js";

export type PortfolioSummary = {
  priced: number;
  valueUsd: number;
  feesPriced: number;
  feesUsd: number;
  earning: number;
  feeApr: number | null;
};

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

export function summarizePositions(positions: PositionView[]): PortfolioSummary {
  const priced = positions.flatMap((position) => {
    const valueUsd = positionValueUsd(position);
    return valueUsd === undefined ? [] : [{ position, valueUsd }];
  });
  const feesPriced = positions.filter((position) => position.feesUsd !== undefined);
  const aprPositions = priced.filter(({ position }) => position.feeApr !== undefined);
  const aprWeight = aprPositions.reduce((sum, { valueUsd }) => sum + valueUsd, 0);

  return {
    priced: priced.length,
    valueUsd: priced.reduce((sum, { valueUsd }) => sum + valueUsd, 0),
    feesPriced: feesPriced.length,
    feesUsd: feesPriced.reduce((sum, position) => sum + position.feesUsd!, 0),
    earning: positions.filter((position) => position.status === "in-range").length,
    feeApr: aprWeight > 0
      ? aprPositions.reduce((sum, { position, valueUsd }) => sum + position.feeApr! * valueUsd, 0) / aprWeight
      : null,
  };
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
