import { getAddress, isAddress, type Address, type Hex } from "viem";
import { appFeeBps, appFeeRecipient } from "./fees.js";
import { relayChain } from "./origins.js";

const RELAY_API = "https://api.relay.link";
export const NATIVE_CURRENCY = "0x0000000000000000000000000000000000000000";
const QUOTE_TIMEOUT_MS = 12_000;
const QUOTE_TTL_MS = 4 * 60_000;

export type RelayTransaction = {
  to: Address;
  data: Hex;
  value: string;
  chainId: number;
  description: string;
};

export type RelayCurrency = {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
};

export type RelaySwapQuote = {
  provider: "Relay";
  requestId: string;
  owner: Address;
  originChainId: number;
  destinationChainId: number;
  currencyIn: RelayCurrency;
  currencyOut: RelayCurrency;
  amountIn: string;
  expectedAmountOut: string;
  minimumAmountOut: string;
  amountOutUsd: string | null;
  fees: {
    appBps: number;
    appAmount: string;
    appUsd: string | null;
    relayerUsd: string | null;
    gasUsd: string | null;
  };
  impactPercent: string | null;
  estimatedSeconds: number | null;
  steps: Array<{ id: string; description: string; transactions: RelayTransaction[] }>;
  transactions: RelayTransaction[];
  statusPath: string;
  createdAt: string;
  expiresAt: string;
  notices: string[];
};

/**
 * One Relay quote with Wizzy's app fee attached. Covers same-chain swaps,
 * cross-chain bridges, and cross-chain swaps. Every returned transaction is
 * validated to originate from the connected wallet on the origin chain.
 */
export async function quoteRelaySwap(input: {
  owner: string;
  originChainId: number;
  destinationChainId: number;
  originCurrency: string;
  destinationCurrency: string;
  amountWei: bigint;
}): Promise<RelaySwapQuote> {
  if (!isAddress(input.owner)) throw new Error("owner must be a valid EVM address");
  if (input.amountWei <= 0n) throw new Error("amount must be positive");
  const origin = relayChain(input.originChainId);
  const destination = relayChain(input.destinationChainId);
  const originCurrency = currencyAddress(input.originCurrency);
  const destinationCurrency = currencyAddress(input.destinationCurrency);
  if (origin.id === destination.id && originCurrency === destinationCurrency) throw new Error("Choose a different token to receive");
  const owner = getAddress(input.owner);
  const feeBps = appFeeBps();
  const response = await relayFetch("/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user: owner,
      recipient: owner,
      originChainId: origin.id,
      destinationChainId: destination.id,
      originCurrency,
      destinationCurrency,
      amount: input.amountWei.toString(),
      tradeType: "EXACT_INPUT",
      referrer: "wizzy.meme",
      ...(feeBps > 0 ? { appFees: [{ recipient: appFeeRecipient(), fee: String(feeBps) }] } : {}),
    }),
  });
  const quote = asRecord(await response.json());
  const details = asRecord(quote.details);
  const currencyIn = parseCurrency(asRecord(details.currencyIn));
  const currencyOut = parseCurrency(asRecord(details.currencyOut));
  const rawSteps = quote.steps;
  if (!Array.isArray(rawSteps) || !rawSteps.length) throw new Error("Relay returned no steps");
  const requestId = requiredString(asRecord(rawSteps[0]).requestId ?? quote.requestId, "Relay requestId");
  const steps = rawSteps.map((entry) => {
    const step = asRecord(entry);
    if (step.kind !== "transaction") throw new Error("Relay returned a step this wallet flow cannot sign");
    const id = requiredString(step.id, "Relay step id");
    const description = typeof step.description === "string" ? step.description : id;
    const items = Array.isArray(step.items) ? step.items : [];
    const transactions = items.map((item): RelayTransaction => {
      const data = asRecord(asRecord(item).data);
      const from = requiredAddress(data.from, "Relay transaction sender");
      const chainId = requiredNumber(data.chainId, "Relay transaction chainId");
      if (from.toLowerCase() !== owner.toLowerCase()) throw new Error("Relay sender does not match wallet");
      if (chainId !== origin.id) throw new Error("Relay transaction is not on the origin network");
      return {
        to: requiredAddress(data.to, "Relay transaction target"),
        data: requiredHex(data.data, "Relay transaction data"),
        value: optionalIntegerString(data.value) ?? "0",
        chainId,
        description: `Relay ${description}`,
      };
    });
    if (!transactions.length) throw new Error(`Relay step ${id} has no transaction`);
    return { id, description, transactions };
  });
  const quotedIn = requiredIntegerString(currencyIn.amount, "Relay input amount");
  if (quotedIn !== input.amountWei.toString()) throw new Error("Relay quote changed the requested input amount");
  if (currencyIn.currency.chainId !== origin.id || currencyOut.currency.chainId !== destination.id) throw new Error("Relay quote networks do not match the request");
  if (currencyIn.currency.address.toLowerCase() !== originCurrency.toLowerCase() || currencyOut.currency.address.toLowerCase() !== destinationCurrency.toLowerCase()) {
    throw new Error("Relay quote tokens do not match the request");
  }
  const expectedOut = requiredIntegerString(currencyOut.amount, "Relay expected output");
  const minimumOut = requiredIntegerString(currencyOut.minimumAmount, "Relay minimum output");
  if (BigInt(minimumOut) <= 0n || BigInt(expectedOut) < BigInt(minimumOut)) throw new Error("Relay returned an invalid output range");
  if (originCurrency === NATIVE_CURRENCY) {
    const value = steps.flatMap((step) => step.transactions).reduce((sum, tx) => sum + BigInt(tx.value), 0n);
    if (value !== input.amountWei) throw new Error("Relay deposit value does not match the amount");
  }
  const fees = asRecord(quote.fees);
  const app = optionalRecord(fees.app);
  const relayer = optionalRecord(fees.relayer);
  const gas = optionalRecord(fees.gas);
  const totalImpact = optionalRecord(details.totalImpact);
  const now = new Date();
  return {
    provider: "Relay",
    requestId,
    owner,
    originChainId: origin.id,
    destinationChainId: destination.id,
    currencyIn: currencyIn.currency,
    currencyOut: currencyOut.currency,
    amountIn: quotedIn,
    expectedAmountOut: expectedOut,
    minimumAmountOut: minimumOut,
    amountOutUsd: optionalString(currencyOut.amountUsd),
    fees: {
      appBps: feeBps,
      appAmount: optionalIntegerString(app?.amount) ?? "0",
      appUsd: optionalString(app?.amountUsd),
      relayerUsd: optionalString(relayer?.amountUsd),
      gasUsd: optionalString(gas?.amountUsd),
    },
    impactPercent: optionalString(totalImpact?.percent),
    estimatedSeconds: optionalNumber(details.timeEstimate),
    steps,
    transactions: steps.flatMap((step) => step.transactions),
    statusPath: `/api/relay/status?requestId=${encodeURIComponent(requestId)}`,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + QUOTE_TTL_MS).toISOString(),
    notices: [
      `Wizzy adds a ${(feeBps / 100).toFixed(2)}% fee to this Relay quote. Relay charges its quoted relayer fee separately.`,
      "The minimum amount includes Relay's slippage tolerance. If the intent cannot be filled, Relay refunds this wallet.",
      "Wizzy never holds funds. Tokens land directly in your wallet on the destination network.",
    ],
  };
}

export async function relayIntentStatus(requestId: string): Promise<unknown> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(requestId)) throw new Error("invalid Relay requestId");
  const response = await relayFetch(`/intents/status/v3?requestId=${encodeURIComponent(requestId)}`);
  return response.json();
}

function currencyAddress(value: string): string {
  if (value.toLowerCase() === "eth" || value.toLowerCase() === NATIVE_CURRENCY) return NATIVE_CURRENCY;
  if (!isAddress(value)) throw new Error("currency must be an EVM address or ETH");
  return getAddress(value);
}

function parseCurrency(value: Record<string, unknown>): { currency: RelayCurrency; amount: unknown; minimumAmount: unknown; amountUsd: unknown } {
  const currency = asRecord(value.currency);
  return {
    currency: {
      chainId: requiredNumber(currency.chainId, "Relay currency chain"),
      address: requiredString(currency.address, "Relay currency address"),
      symbol: typeof currency.symbol === "string" ? currency.symbol : "?",
      decimals: typeof currency.decimals === "number" ? currency.decimals : 18,
    },
    amount: value.amount,
    minimumAmount: value.minimumAmount ?? value.amount,
    amountUsd: value.amountUsd,
  };
}

async function relayFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${RELAY_API}${path}`, {
    ...init,
    headers: { accept: "application/json", ...init?.headers },
    signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let message = body.slice(0, 240) || response.statusText;
    try {
      const parsed = JSON.parse(body) as { message?: string; errorCode?: string };
      if (parsed.message) message = friendlyRelayError(parsed.errorCode, parsed.message);
    } catch {
      // Non-JSON error bodies fall back to the raw text.
    }
    throw new Error(message);
  }
  return response;
}

function friendlyRelayError(code: string | undefined, message: string): string {
  if (code === "INSUFFICIENT_LIQUIDITY") return `Relay cannot fill this size right now. ${message.replace(/^Amount is higher than the available liquidity\.?\s*/i, "")}`.trim();
  if (code === "GAS_IMPACT_TOO_HIGH") return "This amount is too small to cover network fees. Try a larger amount.";
  if (code === "SWAP_QUOTE_FAILED") return "Relay could not route this swap. Try again or swap on the venue directly.";
  if (code === "INVALID_INPUT_CURRENCY") return "Relay does not support this token yet.";
  return message;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Relay returned malformed data");
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} is missing`);
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredIntegerString(value: unknown, label: string): string {
  const text = requiredString(value, label);
  if (!/^\d+$/.test(text)) throw new Error(`${label} is invalid`);
  return text;
}

function optionalIntegerString(value: unknown): string | null {
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} is missing`);
  return value;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requiredAddress(value: unknown, label: string): Address {
  const text = requiredString(value, label);
  if (!isAddress(text)) throw new Error(`${label} is invalid`);
  return getAddress(text);
}

function requiredHex(value: unknown, label: string): Hex {
  const text = requiredString(value, label);
  if (!/^0x[0-9a-fA-F]+$/.test(text) || text === "0x") throw new Error(`${label} is invalid`);
  return text as Hex;
}
