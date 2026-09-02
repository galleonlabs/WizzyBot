import { describe, expect, it } from "vitest";
import { createPositionUrl, fomoTokenUrl, managePositionUrl } from "../app/lib/links.js";

const BRETT = "0x532f27101965dd16442E59d40670FaF5eBB142E4";

describe("venue deep links", () => {
  it("prefills Uniswap's create page with ETH, the meme token, the chain, and the fee tier", () => {
    expect(createPositionUrl({ venue: "uniswap-v3", chain: "base", token: BRETT, fee: 10_000 }))
      .toBe(`https://app.uniswap.org/positions/create/v3?currencyA=NATIVE&currencyB=${BRETT}&chain=base&feeTier=10000`);
    expect(createPositionUrl({ venue: "uniswap-v3", chain: "robinhood", token: BRETT, fee: 3000 })).toContain("chain=robinhood&feeTier=3000");
    expect(createPositionUrl({ venue: "uniswap-v2", chain: "base", token: BRETT, fee: 3000 })).toBe(`https://app.uniswap.org/positions/create/v2?currencyA=NATIVE&currencyB=${BRETT}&chain=base`);
    expect(createPositionUrl({ venue: "uniswap-v4", chain: "base", token: BRETT, fee: null })).toBe(`https://app.uniswap.org/positions/create/v4?currencyA=NATIVE&currencyB=${BRETT}&chain=base`);
  });

  it("points Aerodrome deposits at the pool's tick spacing", () => {
    expect(createPositionUrl({ venue: "aerodrome-slipstream", chain: "base", token: BRETT, quote: "0x4200000000000000000000000000000000000006", tickSpacing: 200 }))
      .toBe(`https://aerodrome.finance/deposit?token0=0x4200000000000000000000000000000000000006&token1=${BRETT}&type=200`);
  });

  it("links existing positions to the venue page that manages them", () => {
    expect(managePositionUrl({ venue: "uniswap-v3", chain: "base", tokenId: "5914496" })).toBe("https://app.uniswap.org/positions/v3/base/5914496");
    expect(managePositionUrl({ venue: "uniswap-v4", chain: "robinhood", tokenId: "9" })).toBe("https://app.uniswap.org/positions/v4/robinhood/9");
    expect(managePositionUrl({ venue: "uniswap-v2", chain: "base", pool: "0xabc" })).toBe("https://app.uniswap.org/positions/v2/base/0xabc");
    expect(managePositionUrl({ venue: "aerodrome-slipstream", chain: "base", tokenId: "1" })).toBe("https://aerodrome.finance/dash");
    expect(fomoTokenUrl("base", BRETT)).toBe(`https://fomo.family/tokens/base/${BRETT.toLowerCase()}?r=makemememarkets`);
  });
});
