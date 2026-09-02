import { describe, expect, it } from "vitest";
import { getAddress, type Address, type PublicClient } from "viem";
import { ADDRESSES } from "../src/constants.js";
import { addressesFor } from "../src/chains.js";
import { parseProtocol, parseTokenId, pairFromTokenId, writeTarget } from "../src/core/protocol.js";
import { V2Protocol, V4Protocol, adapterFor } from "../src/core/protocols.js";
import { planCompound, planExit, planRerange, type PlanContext } from "../src/core/actions.js";
import { hydrateCalldata } from "../src/core/hydrate.js";
import { addLiquidityTx, removeLiquidityTx } from "../src/uniswap/v2-calldata.js";
import { V4_ACTIONS, encodeModifyLiquidities, v4ClaimFeesTx, v4MintTx } from "../src/uniswap/v4-calldata.js";
import { LpApi } from "../src/uniswap/lp-api.js";
import { planMint, quoteMintFromPool, quoteMintV2 } from "../src/core/mint.js";
import { assertUnhooked, decodePositionInfo, signExtend24 } from "../src/chain/v4.js";
import type { PositionSnapshot } from "../src/types.js";

const owner = getAddress("0x1111111111111111111111111111111111111111");
const pair = getAddress("0x2222222222222222222222222222222222222222");

function ctx(over: Partial<PlanContext> = {}): PlanContext {
  return {
    owner,
    dryRun: true,
    noFee: false,
    feeSource: "fees",
    minFeeUsd: 1,
    minPositionUsd: 50,
    feesUsd: 25,
    notionalUsd: 4000,
    gasUsd: 0.2,
    takeBps: 200,
    ...over,
  };
}

function snap(over: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    ref: { protocol: "V3", chainId: 8453, tokenId: 7n },
    owner,
    token0: { address: ADDRESSES.weth, symbol: "WETH", decimals: 18 },
    token1: { address: ADDRESSES.usdc, symbol: "USDC", decimals: 6 },
    fee: 500,
    tickSpacing: 10,
    tickLower: -200,
    tickUpper: 200,
    tickCurrent: 0,
    sqrtPriceX96: 2n ** 96n,
    liquidity: 1_000_000n,
    tokensOwed0: 0n,
    tokensOwed1: 0n,
    uncollected0: 1_000_000_000_000_000n,
    uncollected1: 5_000_000n,
    amount0: 10n ** 18n,
    amount1: 3_000_000_000n,
    inRange: true,
    percentThroughRange: 50,
    pool: pair,
    ...over,
  };
}

function mockClient(handlers: Record<string, unknown>): PublicClient {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (!(functionName in handlers)) throw new Error(`unexpected ${functionName}`);
      const v = handlers[functionName];
      return typeof v === "function" ? (v as () => unknown)() : v;
    },
  } as unknown as PublicClient;
}

describe("parseProtocol / tokenId", () => {
  it("defaults to v3 and accepts v2|v4", () => {
    expect(parseProtocol()).toBe("V3");
    expect(parseProtocol("v2")).toBe("V2");
    expect(parseProtocol("4")).toBe("V4");
    expect(() => parseProtocol("v5")).toThrow(/v2\|v3\|v4/);
  });

  it("encodes a v2 pair address as tokenId", () => {
    const id = parseTokenId(pair, "V2");
    expect(pairFromTokenId(id)).toBe(pair);
    expect(writeTarget("V2")).toBe(ADDRESSES.v2Router);
    expect(writeTarget("V4")).toBe(ADDRESSES.v4PositionManager);
    expect(writeTarget("V3")).toBe(ADDRESSES.nfpm);
    expect(writeTarget("V2", 4663)).toBe(addressesFor("robinhood").v2Router);
    expect(writeTarget("V4", 4663)).toBe(addressesFor("robinhood").v4PositionManager);
    expect(writeTarget("V3", 4663)).toBe(addressesFor("robinhood").nfpm);
  });
});

describe("v2 calldata", () => {
  it("add/remove target Router02 with non-empty data", () => {
    const add = addLiquidityTx({
      tokenA: ADDRESSES.weth,
      tokenB: ADDRESSES.usdc,
      amountADesired: 10n ** 18n,
      amountBDesired: 3_000_000_000n,
      recipient: owner,
    });
    expect(add.to).toBe(ADDRESSES.v2Router);
    expect(add.data.startsWith("0x")).toBe(true);
    expect(add.data.length).toBeGreaterThan(10);
    expect(add.description).toMatch(/addLiquidity/);

    const rem = removeLiquidityTx({
      tokenA: ADDRESSES.weth,
      tokenB: ADDRESSES.usdc,
      liquidity: 100n,
      recipient: owner,
    });
    expect(rem.to).toBe(ADDRESSES.v2Router);
    expect(rem.description).toMatch(/removeLiquidity/);
  });

  it("addLiquidityETH sends value", () => {
    const tx = addLiquidityTx({
      tokenA: ADDRESSES.weth,
      tokenB: ADDRESSES.usdc,
      amountADesired: 10n ** 18n,
      amountBDesired: 1_000_000n,
      recipient: owner,
      useNative: true,
      nativeIsTokenA: true,
    });
    expect(tx.value).toBe(10n ** 18n);
    expect(tx.description).toMatch(/ETH/);
  });

  it("uses Robinhood Router02 for Robinhood v2 approvals and exits", () => {
    const position = snap({
      ref: { protocol: "V2", chainId: 4663, tokenId: BigInt(pair) },
      pool: pair,
      liquidity: 100n,
    });
    const exit = hydrateCalldata(planExit(position, ctx(), {}), position, owner);
    expect(exit.txs[0]?.to).toBe(pair);
    expect(exit.txs[1]?.to).toBe(addressesFor("robinhood").v2Router);
  });
});

describe("v4 calldata", () => {
  it("mint and 0-liq claim target PositionManager", () => {
    const mint = v4MintTx({
      poolKey: {
        currency0: ADDRESSES.weth,
        currency1: ADDRESSES.usdc,
        fee: 500,
        tickSpacing: 10,
        hooks: ADDRESSES.nativeEth,
      },
      tickLower: -200,
      tickUpper: 200,
      liquidity: 1000n,
      amount0: 10n ** 18n,
      amount1: 1_000_000n,
      recipient: owner,
    });
    expect(mint.to).toBe(ADDRESSES.v4PositionManager);
    expect(mint.data).not.toBe("0x");
    expect(mint.description).toMatch(/modifyLiquidities mint/);

    const claim = v4ClaimFeesTx(snap({ ref: { protocol: "V4", chainId: 8453, tokenId: 9n } }), owner);
    expect(claim.to).toBe(ADDRESSES.v4PositionManager);
    expect(claim.description).toMatch(/0-liq/);
  });

  it("refuses unknown hooks", () => {
    expect(() =>
      v4MintTx({
        poolKey: {
          currency0: ADDRESSES.weth,
          currency1: ADDRESSES.usdc,
          fee: 500,
          tickSpacing: 10,
          hooks: getAddress("0x3333333333333333333333333333333333333333"),
        },
        tickLower: -10,
        tickUpper: 10,
        liquidity: 1n,
        amount0: 1n,
        amount1: 1n,
        recipient: owner,
      }),
    ).toThrow(/hooks/);
    expect(() => assertUnhooked(getAddress("0x3333333333333333333333333333333333333333"))).toThrow(/hooks/);
  });

  it("packs actions as bytes", () => {
    const data = encodeModifyLiquidities([V4_ACTIONS.DECREASE_LIQUIDITY, V4_ACTIONS.TAKE_PAIR], ["0x01", "0x02"]);
    expect(data.startsWith("0x")).toBe(true);
  });
});

describe("v2 adapter (mocked)", () => {
  it("checks watched pairs concurrently", async () => {
    let activePairReads = 0;
    let maxConcurrentPairReads = 0;
    const client = {
      chain: { id: 8453 },
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "getPair") {
          activePairReads += 1;
          maxConcurrentPairReads = Math.max(maxConcurrentPairReads, activePairReads);
          await new Promise((resolve) => setTimeout(resolve, 5));
          activePairReads -= 1;
          return pair;
        }
        if (functionName === "balanceOf") return 0n;
        throw new Error(functionName);
      },
    } as unknown as PublicClient;

    await new V2Protocol(client).listPositions(owner);

    expect(maxConcurrentPairReads).toBeGreaterThan(1);
  });

  it("lists WETH/USDC when the owner holds LP", async () => {
    const client = mockClient({
      getPair: pair,
      balanceOf: 42n,
    });
    const adapter = new V2Protocol(client);
    const refs = await adapter.listPositions(owner);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.protocol).toBe("V2");
    expect(pairFromTokenId(refs[0]!.tokenId)).toBe(pair);
  });

  it("reads reserves into amounts", async () => {
    const client = mockClient({
      token0: ADDRESSES.weth,
      token1: ADDRESSES.usdc,
      getReserves: [10n ** 18n, 3_000_000_000n, 0],
      totalSupply: 100n,
      balanceOf: 25n,
      decimals: (addr?: unknown) => 18,
      symbol: () => "TKN",
    });
    // decimals/symbol are called per token — return numbers/strings not fn via switch
    const client2 = {
      readContract: async ({ functionName }: { functionName: string }) => {
        switch (functionName) {
          case "token0":
            return ADDRESSES.weth;
          case "token1":
            return ADDRESSES.usdc;
          case "getReserves":
            return [100n, 400n, 0];
          case "totalSupply":
            return 100n;
          case "balanceOf":
            return 25n;
          case "decimals":
            return 18;
          case "symbol":
            return "TKN";
          default:
            throw new Error(functionName);
        }
      },
    } as unknown as PublicClient;
    const adapter = new V2Protocol(client2);
    adapter.bindOwner(owner);
    const pos = await adapter.readPosition(BigInt(pair));
    expect(pos.ref.protocol).toBe("V2");
    expect(pos.amount0).toBe(25n);
    expect(pos.amount1).toBe(100n);
    expect(pos.inRange).toBe(true);
    expect(pos.uncollected0).toBe(0n);
    void client;
  });
});

describe("v4 adapter (mocked)", () => {
  it("reads pool key, slot0, and amounts", async () => {
    const tickLower = -200;
    const tickUpper = 200;
    // pack: tickLower at bits 8-31, tickUpper at 32-55
    const info =
      (BigInt(tickLower & 0xffffff) << 8n) |
      (BigInt(tickUpper & 0xffffff) << 32n);
    const client = {
      readContract: async ({ functionName }: { functionName: string }) => {
        switch (functionName) {
          case "ownerOf":
            return owner;
          case "getPositionLiquidity":
            return 1_000_000n;
          case "getPoolAndPositionInfo":
            return [
              {
                currency0: ADDRESSES.weth,
                currency1: ADDRESSES.usdc,
                fee: 500,
                tickSpacing: 10,
                hooks: ADDRESSES.nativeEth,
              },
              info,
            ];
          case "getSlot0":
            return [2n ** 96n, 0, 0, 500];
          case "getLiquidity":
            return 1_000_000n;
          case "getFeeGrowthInside":
            return [0n, 0n];
          case "getPositionInfo":
            return [1_000_000n, 0n, 0n];
          case "decimals":
            return 18;
          case "symbol":
            return "TKN";
          default:
            throw new Error(functionName);
        }
      },
    } as unknown as PublicClient;
    const adapter = new V4Protocol(client);
    const pos = await adapter.readPosition(99n);
    expect(pos.ref.protocol).toBe("V4");
    expect(pos.owner).toBe(owner);
    expect(pos.tickLower).toBe(tickLower);
    expect(pos.tickUpper).toBe(tickUpper);
    expect(pos.fee).toBe(500);
    expect(pos.liquidity).toBe(1_000_000n);
  });

  it("refuses hooked positions", async () => {
    const client = {
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "ownerOf") return owner;
        if (functionName === "getPositionLiquidity") return 1n;
        if (functionName === "getPoolAndPositionInfo") {
          return [
            {
              currency0: ADDRESSES.weth,
              currency1: ADDRESSES.usdc,
              fee: 500,
              tickSpacing: 10,
              hooks: getAddress("0x3333333333333333333333333333333333333333"),
            },
            0n,
          ];
        }
        throw new Error(functionName);
      },
    } as unknown as PublicClient;
    await expect(new V4Protocol(client).readPosition(1n)).rejects.toThrow(/hooks/);
  });
});

describe("v2/v4 plans", () => {
  it("compound and range skip on v2; exit uses Router02", () => {
    const v2 = snap({ ref: { protocol: "V2", chainId: 8453, tokenId: BigInt(pair) } });
    expect(planCompound(v2, ctx()).skipped).toBe(true);
    expect(planCompound(v2, ctx()).reason).toMatch(/embedded/);
    expect(planRerange(v2, ctx(), { oorPercent: 0 }).skipped).toBe(true);
    const exit = planExit(v2, ctx());
    expect(exit.skipped).toBe(false);
    expect(exit.actions.some((a) => a.kind === "approve")).toBe(true);
    expect(exit.actions.some((a) => a.description.includes("Router02") || a.tx?.to === ADDRESSES.v2Router)).toBe(true);
    expect(exit.actions.some((a) => a.kind === "burn")).toBe(false);
    const filled = hydrateCalldata(exit, v2, owner);
    expect(filled.txs.some((t) => t.to === ADDRESSES.v2Router && t.data !== "0x")).toBe(true);
  });

  it("v4 compound hydrates 0-liq claim + increase", () => {
    const v4 = snap({ ref: { protocol: "V4", chainId: 8453, tokenId: 44n }, tickCurrent: 0, inRange: true });
    const receipt = planCompound(v4, ctx());
    expect(receipt.skipped).toBe(false);
    const filled = hydrateCalldata(receipt, v4, owner);
    expect(filled.txs.some((t) => t.description.includes("0-liq"))).toBe(true);
    expect(filled.txs.every((t) => t.to === ADDRESSES.v4PositionManager || t.to === ADDRESSES.usdc || t.to === ADDRESSES.weth || t.to === ADDRESSES.universalRouter)).toBe(true);
  });
});

describe("mint quotes per protocol", () => {
  const token0 = { address: ADDRESSES.weth, symbol: "WETH", decimals: 18 };
  const token1 = { address: ADDRESSES.usdc, symbol: "USDC", decimals: 6 };

  it("plans v2 addLiquidity to Router02", () => {
    const quote = quoteMintV2({
      token0,
      token1,
      reserve0: 10n ** 18n,
      reserve1: 3_000_000_000n,
      pool: pair,
      amount0Desired: 10n ** 18n,
      amount1Desired: 3_000_000_000n,
    });
    expect(quote.protocol).toBe("V2");
    const receipt = planMint(quote, owner, true);
    expect(receipt.txs.some((t) => t.to === ADDRESSES.v2Router)).toBe(true);
    expect(receipt.to).toContain(ADDRESSES.v2Router);
  });

  it("plans v4 mint to PositionManager + Permit2", () => {
    const quote = quoteMintFromPool({
      protocol: "V4",
      token0,
      token1,
      fee: 500,
      sqrtPriceX96: 2n ** 96n,
      tickCurrent: 0,
      pool: ADDRESSES.v4PoolManager,
      widthPct: 10,
      amount0Desired: 10n ** 18n,
      amount1Desired: 3_000_000_000n,
    });
    expect(quote.protocol).toBe("V4");
    const receipt = planMint(quote, owner, true);
    expect(receipt.txs.some((t) => t.to === ADDRESSES.v4PositionManager)).toBe(true);
    expect(receipt.txs.some((t) => t.to === ADDRESSES.permit2)).toBe(true);
    expect(receipt.to).toContain(ADDRESSES.v4PositionManager);
  });
});

describe("LP API protocols", () => {
  it("create/createClassic/claimFees honor V2/V3/V4", async () => {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const http = {
      lp: async <T>(path: string, body: unknown) => {
        calls.push({ path, body: body as Record<string, unknown> });
        return { create: { to: ADDRESSES.v2Router, data: "0x1234", value: "0" } } as T;
      },
      trade: async <T>() => ({}) as T,
    };
    const api = new LpApi(http);
    await api.create({
      walletAddress: owner,
      protocol: "V4",
      chainId: 8453,
      existingPool: { token0Address: ADDRESSES.weth, token1Address: ADDRESSES.usdc, poolReference: "0xabc" },
      independentToken: { tokenAddress: ADDRESSES.weth, amount: "1" },
    });
    expect(calls.at(-1)?.body.protocol).toBe("V4");
    await api.createClassic({
      walletAddress: owner,
      poolParameters: { token0Address: ADDRESSES.weth, token1Address: ADDRESSES.usdc, chainId: 8453 },
      independentToken: { tokenAddress: ADDRESSES.weth, amount: "1" },
    });
    expect(calls.at(-1)?.path).toBe("/lp/create_classic");
    expect(() =>
      api.claimFees({ protocol: "V2" as unknown as "V3", walletAddress: owner, chainId: 8453, tokenId: "1" }),
    ).toThrow(/claim_fees/);
    await api.increase({
      walletAddress: owner,
      chainId: 8453,
      protocol: "V2",
      token0Address: ADDRESSES.weth,
      token1Address: ADDRESSES.usdc,
      independentToken: { tokenAddress: ADDRESSES.weth, amount: "1" },
    });
    expect(calls.at(-1)?.body.protocol).toBe("V2");
  });
});

describe("position info packing", () => {
  it("sign-extends 24-bit ticks", () => {
    expect(signExtend24(0xffffffn)).toBe(-1);
    expect(decodePositionInfo((BigInt(-200 & 0xffffff) << 8n) | (BigInt(200) << 32n))).toEqual({
      tickLower: -200,
      tickUpper: 200,
    });
  });
});

describe("adapterFor", () => {
  it("returns the requested protocol", () => {
    expect(adapterFor("V2", {} as never).protocol).toBe("V2");
    expect(adapterFor("V4", {} as never).protocol).toBe("V4");
    expect(adapterFor("V3", {} as never).protocol).toBe("V3");
  });
});
