import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { feeGrowthInside, subUint256, uncollectedFees } from "../src/chain/fees-onchain.js";

describe("uint256 fee growth", () => {
  it("wraps subtraction the way Solidity uint256 does", () => {
    expect(subUint256(1n, 2n)).toBe((1n << 256n) - 1n);
    expect(subUint256(10n, 3n)).toBe(7n);
  });

  it("computes in-range feeGrowthInside without going negative", () => {
    const inside = feeGrowthInside({
      tickCurrent: 0,
      tickLower: -10,
      tickUpper: 10,
      feeGrowthGlobal0X128: 100n,
      feeGrowthGlobal1X128: 100n,
      lower: { feeGrowthOutside0X128: 10n, feeGrowthOutside1X128: 10n },
      upper: { feeGrowthOutside0X128: 5n, feeGrowthOutside1X128: 5n },
    });
    expect(inside.inside0).toBe(85n);
    expect(inside.inside1).toBe(85n);
    const fees = uncollectedFees({
      liquidity: 0n,
      tokensOwed0: 3n,
      tokensOwed1: 4n,
      feeGrowthInside0LastX128: 0n,
      feeGrowthInside1LastX128: 0n,
      inside0: inside.inside0,
      inside1: inside.inside1,
    });
    expect(fees.amount0).toBe(3n);
    expect(fees.amount1).toBe(4n);
  });
});

describe("no org branding in product strings", () => {
  it("does not mention Galleon anywhere under src/", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|json|md)$/.test(name)) files.push(p);
      }
    };
    walk(join(process.cwd(), "src"));
    for (const file of files) {
      const body = readFileSync(file, "utf8");
      expect(body, file).not.toMatch(/galleon/i);
    }
  });
});
