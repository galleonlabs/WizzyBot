import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { ADDRESSES, CHAIN_ID, SIGNER_ALLOWLIST } from "../src/constants.js";
import {
  CHAINS,
  addressesFor,
  parseChainSlug,
  signerAllowlistFor,
  slugForChainId,
} from "../src/chains.js";
import { isAllowedTarget, allowlistWithTokens } from "../src/signer/allowlist.js";
import { resolveMintToken } from "../src/core/mint.js";
import { LpApi } from "../src/uniswap/lp-api.js";

describe("chain registry", () => {
  it("parses slugs and keeps Base as default", () => {
    expect(parseChainSlug()).toBe("base");
    expect(parseChainSlug("base")).toBe("base");
    expect(parseChainSlug("8453")).toBe("base");
    expect(parseChainSlug("robinhood")).toBe("robinhood");
    expect(parseChainSlug("4663")).toBe("robinhood");
    expect(parseChainSlug("rh")).toBe("robinhood");
    expect(() => parseChainSlug("ethereum")).toThrow(/base\|robinhood/);
    expect(slugForChainId(8453)).toBe("base");
    expect(slugForChainId(4663)).toBe("robinhood");
  });

  it("keeps Base aliases and does not union allowlists", () => {
    expect(CHAINS.base.id).toBe(CHAIN_ID);
    expect(addressesFor("base").nfpm).toBe(ADDRESSES.nfpm);
    expect(signerAllowlistFor("base")).toEqual(SIGNER_ALLOWLIST);
    expect(CHAINS.robinhood.id).toBe(4663);
    expect(CHAINS.robinhood.label).toBe("Robinhood");
    expect(addressesFor("robinhood").usdc).toBeUndefined();
    expect(addressesFor("robinhood").usdg).toBe(getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"));
    expect(isAllowedTarget(ADDRESSES.nfpm)).toBe(true);
    expect(isAllowedTarget(ADDRESSES.nfpm, [], "robinhood")).toBe(false);
    expect(isAllowedTarget(addressesFor("robinhood").nfpm, [], "robinhood")).toBe(true);
    const extra = allowlistWithTokens(ADDRESSES.weth, ADDRESSES.usdc, "robinhood");
    expect(extra).toContain(addressesFor("robinhood").nfpm);
    expect(extra).not.toContain(ADDRESSES.nfpm);
  });

  it("rejects USDC on Robinhood and points at USDG", () => {
    expect(resolveMintToken("USDC").address).toBe(ADDRESSES.usdc);
    expect(() => resolveMintToken("USDC", "robinhood")).toThrow(/USDG/);
    expect(resolveMintToken("USDG", "robinhood").address).toBe(addressesFor("robinhood").usdg);
    expect(resolveMintToken("WETH", "robinhood").address).toBe(addressesFor("robinhood").weth);
    expect(resolveMintToken("ETH", "robinhood").address).toBe(addressesFor("robinhood").weth);
  });

  it("sends Robinhood chainId on LP API create", async () => {
    const posted: unknown[] = [];
    const api = new LpApi({
      lp: async (_path, body) => {
        posted.push(body);
        return { create: { to: "0x1", data: "0x", value: "0" } };
      },
    } as never);
    await api.create({
      walletAddress: "0x0000000000000000000000000000000000000001",
      protocol: "V3",
      chainId: 4663,
      independentToken: { tokenAddress: "0x0", amount: "1" },
    });
    expect((posted[0] as { chainId: number }).chainId).toBe(4663);
  });
});
