import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { ADDRESSES, SIGNER_ALLOWLIST, TREASURY } from "../src/constants.js";
import { allowlistWithTokens, assertAllowedTarget, isAllowedTarget } from "../src/signer/allowlist.js";

describe("signer allowlist", () => {
  it("allows NFPM, Permit2, Universal Router, and treasury", () => {
    expect(isAllowedTarget(ADDRESSES.nfpm)).toBe(true);
    expect(isAllowedTarget(ADDRESSES.permit2)).toBe(true);
    expect(isAllowedTarget(ADDRESSES.universalRouter)).toBe(true);
    expect(isAllowedTarget(ADDRESSES.swapRouter02)).toBe(true);
    expect(isAllowedTarget(TREASURY)).toBe(true);
    expect(SIGNER_ALLOWLIST).toEqual(
      expect.arrayContaining([
        ADDRESSES.nfpm,
        ADDRESSES.permit2,
        ADDRESSES.universalRouter,
        TREASURY,
      ]),
    );
  });

  it("rejects an arbitrary address and mentions the allowlist", () => {
    const random = getAddress("0x1111111111111111111111111111111111111111");
    expect(isAllowedTarget(random)).toBe(false);
    expect(() => assertAllowedTarget(random)).toThrow(/NFPM, Permit2, Universal Router, treasury/);
    try {
      assertAllowedTarget(random);
    } catch (err) {
      expect(String(err)).not.toMatch(/galleon/i);
    }
  });

  it("adds position tokens only for the in-flight action", () => {
    const extra = allowlistWithTokens(ADDRESSES.weth, ADDRESSES.usdc);
    expect(isAllowedTarget(ADDRESSES.weth, extra)).toBe(true);
    expect(isAllowedTarget(ADDRESSES.usdc, extra)).toBe(true);
    expect(isAllowedTarget(ADDRESSES.weth)).toBe(false);
  });
});
