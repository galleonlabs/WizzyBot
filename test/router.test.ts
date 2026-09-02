import { describe, expect, it } from "vitest";
import { toFunctionSelector } from "viem";
import { addressesFor } from "../src/chains.js";
import { exactInV3Tx } from "../src/uniswap/router.js";

describe("v3 swap routing", () => {
  it("uses Robinhood SwapRouter02 instead of the incompatible Universal Router command", () => {
    const addresses = addressesFor("robinhood");
    const transaction = exactInV3Tx({
      tokenIn: addresses.weth,
      tokenOut: "0x020bfC650A365f8BB26819deAAbF3E21291018b4",
      fee: 3_000,
      amountIn: 1_000n,
      amountOutMin: 1n,
      recipient: "0x1111111111111111111111111111111111111111",
      chainId: 4663,
    });

    expect(transaction.to).toBe(addresses.swapRouter02);
    expect(transaction.to).not.toBe(addresses.universalRouter);
    expect(transaction.data.startsWith(toFunctionSelector(
      "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
    ))).toBe(true);
  });

  it("funds a WETH-input swap with native ETH when requested", () => {
    const addresses = addressesFor("robinhood");
    const transaction = exactInV3Tx({
      tokenIn: addresses.weth,
      tokenOut: "0x020bfC650A365f8BB26819deAAbF3E21291018b4",
      fee: 3_000,
      amountIn: 1_000n,
      amountOutMin: 1n,
      recipient: "0x1111111111111111111111111111111111111111",
      chainId: 4663,
      useNative: true,
    });

    expect(transaction.value).toBe(1_000n);
    expect(() => exactInV3Tx({
      tokenIn: "0x020bfC650A365f8BB26819deAAbF3E21291018b4",
      tokenOut: addresses.weth,
      fee: 3_000,
      amountIn: 1_000n,
      amountOutMin: 1n,
      recipient: "0x1111111111111111111111111111111111111111",
      chainId: 4663,
      useNative: true,
    })).toThrow("native ETH can only fund a WETH input swap");
  });
});
