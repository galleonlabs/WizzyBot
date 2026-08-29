import { afterEach, describe, expect, it, vi } from "vitest";
import { quoteBaseToRobinhoodEth, quoteBaseToSolanaSol, relayIntentStatus } from "../src/relay/client.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const DEPOSITORY = "0x4cd00e387622c35bddb9b4c962c136462338bc31";
const REQUEST_ID = `0x${"ab".repeat(32)}`;
const SOLANA_OWNER = "8fdUHxiuNRzo5pL6sWTbKac5VfPQKuWuuYPutt3DtuMY";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Relay funding", () => {
  it("returns only the validated Base deposit transaction", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(relayQuote()), { status: 200 })) as typeof fetch;
    const quote = await quoteBaseToRobinhoodEth({ owner: OWNER, amountInWei: 5_000_000_000_000_000n });
    expect(quote.requestId).toBe(REQUEST_ID);
    expect(quote.transaction.to.toLowerCase()).toBe(DEPOSITORY);
    expect(quote.transaction.value).toBe("5000000000000000");
    expect(quote.minimumAmountOutWei).toBe("4888000000000000");
    expect(quote.expectedAmountOutWei).toBe("4988000000000000");
  });

  it("rejects a quote whose transaction target differs from its depository", async () => {
    const payload = relayQuote();
    payload.steps[0]!.items[0]!.data.to = "0x2222222222222222222222222222222222222222";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
    await expect(quoteBaseToRobinhoodEth({ owner: OWNER, amountInWei: 5_000_000_000_000_000n })).rejects.toThrow(/depository/);
  });

  it("validates a Base to native SOL quote for the Privy Solana wallet", async () => {
    const payload = relayQuote();
    payload.details.currencyOut = {
      amount: "579813478",
      minimumAmount: "568217208",
      currency: { chainId: 792703809, address: "11111111111111111111111111111111" },
    };
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
    const quote = await quoteBaseToSolanaSol({ owner: OWNER, recipient: SOLANA_OWNER, amountInWei: 5_000_000_000_000_000n });
    expect(quote.destinationChainId).toBe(792703809);
    expect(quote.recipient).toBe(SOLANA_OWNER);
    expect(quote.minimumAmountOutLamports).toBe("568217208");
    expect(quote.transaction.to.toLowerCase()).toBe(DEPOSITORY);
  });

  it("validates status request IDs before calling Relay", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "success" }), { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;
    await expect(relayIntentStatus("not-an-id")).rejects.toThrow(/requestId/);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(relayIntentStatus(REQUEST_ID)).resolves.toEqual({ status: "success" });
  });
});

function relayQuote() {
  return {
    requestId: REQUEST_ID,
    steps: [{
      kind: "transaction",
      items: [{ data: {
        from: OWNER,
        to: DEPOSITORY,
        data: "0x1234",
        value: "5000000000000000",
        chainId: 8453,
      } }],
    }],
    fees: { relayer: { amount: "12000000000000", amountUsd: "0.03" } },
    details: {
      currencyIn: {
        amount: "5000000000000000",
        currency: { chainId: 8453, address: "0x0000000000000000000000000000000000000000" },
      },
      currencyOut: {
        amount: "4988000000000000",
        minimumAmount: "4888000000000000",
        currency: { chainId: 4663, address: "0x0000000000000000000000000000000000000000" },
      },
      totalImpact: { percent: "-0.24" },
      timeEstimate: 2,
    },
    protocol: { v2: { paymentDetails: { depository: DEPOSITORY } } },
  };
}
