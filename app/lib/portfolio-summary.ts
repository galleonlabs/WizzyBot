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
