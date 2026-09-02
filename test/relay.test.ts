import { afterEach, describe, expect, it, vi } from "vitest";
import { NATIVE_CURRENCY, quoteRelaySwap, relayIntentStatus } from "../src/relay/client.js";
import { RELAY_CHAINS } from "../src/relay/origins.js";
import { WIZZY_APP_FEE_BPS, appFeeBps, appFeeRecipient } from "../src/relay/fees.js";
import { TREASURY } from "../src/constants.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const SOLVER = "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f";
const BRETT = "0x532f27101965dd16442E59d40670FaF5eBB142E4";
const REQUEST_ID = `0x${"ab".repeat(32)}`;

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.WIZZY_APP_FEE_BPS;
});

describe("Relay swap quotes", () => {
  it("attaches the treasury app fee to every quote request", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(swapQuote()), { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;
    const quote = await quoteRelaySwap({ owner: OWNER, originChainId: 8453, destinationChainId: 8453, originCurrency: "eth", destinationCurrency: BRETT, amountWei: 10n ** 16n });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.appFees).toEqual([{ recipient: TREASURY, fee: String(WIZZY_APP_FEE_BPS) }]);
    expect(body.originCurrency).toBe(NATIVE_CURRENCY);
    expect(body.destinationCurrency).toBe(BRETT);
    expect(body.tradeType).toBe("EXACT_INPUT");
    expect(quote.requestId).toBe(REQUEST_ID);
    expect(quote.fees.appBps).toBe(WIZZY_APP_FEE_BPS);
    expect(quote.fees.appAmount).toBe("30000000000000");
    expect(quote.currencyOut.symbol).toBe("BRETT");
    expect(quote.transactions).toHaveLength(1);
    expect(quote.transactions[0]?.to.toLowerCase()).toBe(SOLVER);
    expect(quote.transactions[0]?.value).toBe("10000000000000000");
    expect(quote.statusPath).toContain(REQUEST_ID);
    expect(quote.notices[0]).toContain("0.30% fee");
  });

  it("keeps approve and swap steps in order for token inputs", async () => {
    const payload = swapQuote();
    payload.details.currencyIn = { currency: { chainId: 8453, address: BRETT.toLowerCase(), symbol: "BRETT", decimals: 18 }, amount: "1000", amountUsd: "1" };
    payload.details.currencyOut = { currency: { chainId: 8453, address: NATIVE_CURRENCY, symbol: "ETH", decimals: 18 }, amount: "900", minimumAmount: "880", amountUsd: "0.9" };
    payload.steps = [
      { id: "approve", kind: "transaction", description: "Approve BRETT", requestId: REQUEST_ID, items: [{ data: { from: OWNER, to: BRETT, data: "0x095ea7b3", value: "0", chainId: 8453 } }] },
      { id: "swap", kind: "transaction", description: "Swapping BRETT for ETH", requestId: REQUEST_ID, items: [{ data: { from: OWNER, to: SOLVER, data: "0xcd6e13f7", value: "0", chainId: 8453 } }] },
    ];
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
    const quote = await quoteRelaySwap({ owner: OWNER, originChainId: 8453, destinationChainId: 8453, originCurrency: BRETT, destinationCurrency: "eth", amountWei: 1000n });
    expect(quote.steps.map((step) => step.id)).toEqual(["approve", "swap"]);
    expect(quote.transactions[0]?.description).toBe("Relay Approve BRETT");
  });

  it("rejects quotes whose transactions do not come from the wallet on the origin network", async () => {
    const stranger = swapQuote();
    stranger.steps[0]!.items[0]!.data.from = "0x2222222222222222222222222222222222222222";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(stranger), { status: 200 })) as typeof fetch;
    await expect(quoteRelaySwap({ owner: OWNER, originChainId: 8453, destinationChainId: 8453, originCurrency: "eth", destinationCurrency: BRETT, amountWei: 10n ** 16n })).rejects.toThrow(/does not match wallet/);

    const wrongChain = swapQuote();
    wrongChain.steps[0]!.items[0]!.data.chainId = 1;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(wrongChain), { status: 200 })) as typeof fetch;
    await expect(quoteRelaySwap({ owner: OWNER, originChainId: 8453, destinationChainId: 8453, originCurrency: "eth", destinationCurrency: BRETT, amountWei: 10n ** 16n })).rejects.toThrow(/origin network/);

    const shortValue = swapQuote();
    shortValue.steps[0]!.items[0]!.data.value = "1";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(shortValue), { status: 200 })) as typeof fetch;
    await expect(quoteRelaySwap({ owner: OWNER, originChainId: 8453, destinationChainId: 8453, originCurrency: "eth", destinationCurrency: BRETT, amountWei: 10n ** 16n })).rejects.toThrow(/deposit value/);
  });

  it("turns Relay error codes into plain guidance", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ errorCode: "INSUFFICIENT_LIQUIDITY", message: "Amount is higher than the available liquidity. Max amount is $308 USD" }), { status: 400 })) as typeof fetch;
    await expect(quoteRelaySwap({ owner: OWNER, originChainId: 8453, destinationChainId: 4663, originCurrency: "eth", destinationCurrency: BRETT, amountWei: 10n ** 18n })).rejects.toThrow("Relay cannot fill this size right now. Max amount is $308 USD");
  });

  it("supports only the five pay-from networks the wallet client knows", () => {
    expect(RELAY_CHAINS.map((chain) => chain.id)).toEqual([8453, 4663, 1, 42161, 10]);
    expect(RELAY_CHAINS.find((chain) => chain.id === 4663)?.label).toBe("Robinhood Chain");
  });

  it("pays fees to the treasury and lets the environment override the rate within bounds", () => {
    expect(appFeeRecipient()).toBe(TREASURY);
    expect(appFeeBps()).toBe(30);
    process.env.WIZZY_APP_FEE_BPS = "45";
    expect(appFeeBps()).toBe(45);
    process.env.WIZZY_APP_FEE_BPS = "9999";
    expect(appFeeBps()).toBe(30);
  });

  it("only polls well-formed request ids", async () => {
    await expect(relayIntentStatus("nope")).rejects.toThrow(/invalid Relay requestId/);
  });
});

function swapQuote(): {
  steps: Array<{ id: string; kind: string; description: string; requestId: string; items: Array<{ data: { from: string; to: string; data: string; value: string; chainId: number } }> }>;
  fees: Record<string, unknown>;
  details: Record<string, unknown>;
} {
  return {
    steps: [{
      id: "swap",
      kind: "transaction",
      description: "Swapping ETH for BRETT",
      requestId: REQUEST_ID,
      items: [{ data: { from: OWNER, to: SOLVER, data: "0xcd6e13f70000", value: "10000000000000000", chainId: 8453 } }],
    }],
    fees: {
      gas: { amount: "3002229996287", amountUsd: "0.007195" },
      relayer: { amount: "15006554174215", amountUsd: "0.035963" },
      app: { amount: "30000000000000", amountUsd: "0.071895" },
    },
    details: {
      currencyIn: { currency: { chainId: 8453, address: NATIVE_CURRENCY, symbol: "ETH", decimals: 18 }, amount: "10000000000000000", amountUsd: "24" },
      currencyOut: { currency: { chainId: 8453, address: BRETT.toLowerCase(), symbol: "BRETT", decimals: 18 }, amount: "4860967208359877243920", minimumAmount: "4812357536276278471481", amountUsd: "23.77" },
      totalImpact: { percent: "-0.73" },
      timeEstimate: 2,
    },
  };
}
