import { describe, expect, it } from "vitest";
import { positionRangeGeometry, positionRangePreview } from "../app/lib/cards.js";

describe("position range geometry", () => {
  it("places an in-range current tick inside the working range", () => {
    const geometry = positionRangeGeometry({ fullRange: false, tickLower: -1_000, tickUpper: 1_000, tickCurrent: 500 });
    expect(geometry.currentState).toBe("inside");
    expect(geometry.currentPct).toBeGreaterThan(geometry.rangeStartPct);
    expect(geometry.currentPct).toBeLessThan(geometry.rangeEndPct);
  });

  it("previews the same aligned range presets used by the wallet planner", () => {
    const position = { fee: 500, price: 1, tickLower: -200, tickUpper: 200, tickCurrent: 50, tickSpacing: 10 };
    expect(positionRangePreview(position, "focused")).toMatchObject({ tickLower: -70, tickUpper: 170 });
    expect(positionRangePreview(position, "balanced")).toMatchObject({ tickLower: -150, tickUpper: 250 });
    expect(positionRangePreview(position, "wide")).toMatchObject({ tickLower: -310, tickUpper: 410 });
    expect(positionRangePreview(position, "balanced")).toMatchObject({ currentTick: 50, currentPrice: 1 });
  });

  it("keeps an out-of-range price visibly outside the working range", () => {
    const geometry = positionRangeGeometry({ fullRange: false, tickLower: -1_000, tickUpper: 1_000, tickCurrent: 1_500 });
    expect(geometry.currentState).toBe("above");
    expect(geometry.currentPct).toBeGreaterThan(geometry.rangeEndPct);
  });

  it("uses the entire axis for V2 full-range liquidity", () => {
    expect(positionRangeGeometry({ fullRange: true, tickLower: 0, tickUpper: 0, tickCurrent: 0 })).toEqual({
      rangeStartPct: 4,
      rangeEndPct: 96,
      currentPct: 50,
      currentState: "inside",
    });
  });
});
