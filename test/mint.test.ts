import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { ADDRESSES, TREASURY } from "../src/constants.js";
import { planMint, quoteMintFromPool, resolveMintToken, sortPoolPair } from "../src/core/mint.js";
import { wrapEthTx } from "../src/uniswap/calldata.js";
import { V4_NEXT, V4Protocol, adapterFor } from "../src/core/protocols.js";

const owner = getAddress("0x1111111111111111111111111111111111111111");

const token0 = { address: ADDRESSES.weth, symbol: "WETH", decimals: 18 };
const token1 = { address: ADDRESSES.usdc, symbol: "USDC", decimals: 6 };

describe("mint planning", () => {
  it("snaps width ticks and plans a two-sided mint to NFPM", () => {
    const quote = quoteMintFromPool({
      token0,
      token1,
      fee: 500,
      sqrtPriceX96: 2n ** 96n,
      tickCurrent: 0,
      pool: getAddress("0x2222222222222222222222222222222222222222"),
      widthPct: 10,
      amount0Desired: 10n ** 18n,
      amount1Desired: 3_000_000_000n,
    });
    expect(quote.tickLower % 10 === 0).toBe(true);
    expect(quote.tickUpper % 10 === 0).toBe(true);
    expect(quote.tickLower).toBeLessThan(0);
    expect(quote.tickUpper).toBeGreaterThan(0);
    expect(quote.singleSided).toBe(false);
    expect(quote.amount0).toBeGreaterThan(0n);
    expect(quote.amount1).toBeGreaterThan(0n);

    const receipt = planMint(quote, owner, true);
    expect(receipt.action).toBe("mint");
    expect(receipt.dryRun).toBe(true);
    expect(receipt.treasuryFee).toBeNull();
    expect(receipt.actions.map((a) => a.kind)).toEqual(expect.arrayContaining(["approve", "mint"]));
    expect(receipt.txs.some((t) => t.to === ADDRESSES.nfpm)).toBe(true);
    expect(receipt.txs.every((t) => t.data !== "0x")).toBe(true);
    expect(TREASURY).toBe("0xC141Cbe4f4a9CAbc3cc78159a9268a4e008922CD");
  });

  it("plans a single-sided mint from amount1 only", () => {
    const quote = quoteMintFromPool({
      token0,
      token1,
      fee: 500,
      sqrtPriceX96: 2n ** 96n,
      tickCurrent: 0,
      pool: getAddress("0x2222222222222222222222222222222222222222"),
      tickLower: -200,
      tickUpper: 200,
      amount1Desired: 5_000_000n,
    });
    expect(quote.singleSided).toBe(true);
    const receipt = planMint(quote, owner, true);
    expect(receipt.actions.find((a) => a.kind === "mint")?.description).toMatch(/single-sided/);
  });

  it("marks native ETH wrap and skips WETH approve", () => {
    const quote = quoteMintFromPool({
      token0,
      token1,
      fee: 500,
      sqrtPriceX96: 2n ** 96n,
      tickCurrent: 0,
      pool: getAddress("0x2222222222222222222222222222222222222222"),
      widthPct: 5,
      amount0Desired: 10n ** 18n,
      amount1Desired: 1_000_000n,
      useNative: true,
      nativeIsToken0: true,
    });
    const receipt = planMint(quote, owner, false);
    expect(quote.useNative).toBe(true);
    expect(receipt.actions.some((a) => a.kind === "wrap")).toBe(true);
    expect(receipt.actions.filter((a) => a.kind === "approve" && a.tokenIn === ADDRESSES.weth)).toHaveLength(0);
    const mintTx = receipt.txs.find((t) => t.description === "NFPM.mint");
    expect(mintTx?.value).toBeGreaterThan(0n);
    expect(wrapEthTx(1n).to).toBe(ADDRESSES.weth);
  });

  it("resolves ETH to WETH", () => {
    expect(resolveMintToken("ETH").useNative).toBe(true);
    expect(resolveMintToken("ETH").address).toBe(ADDRESSES.weth);
    expect(resolveMintToken(ADDRESSES.nativeEth).useNative).toBe(true);
    const [a, b] = sortPoolPair(
      { address: ADDRESSES.usdc, useNative: false },
      { address: ADDRESSES.weth, useNative: true },
    );
    expect(a.address.toLowerCase() < b.address.toLowerCase()).toBe(true);
  });
});

describe("protocol adapters", () => {
  it("exposes v2, v3, and v4", () => {
    expect(new V4Protocol().protocol).toBe("V4");
    expect(adapterFor("V4", {} as never).protocol).toBe("V4");
    expect(adapterFor("V2", {} as never).protocol).toBe("V2");
    expect(V4_NEXT).toMatch(/0x498581fF718922c3f8e6A244956aF099B2652b2b/i);
    expect(V4_NEXT).toMatch(/0x7C5f5A4bBd8fD63184577525326123B519429bDc/i);
  });
});
