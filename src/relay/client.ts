import { getAddress, isAddress, type Address, type Hex } from "viem";

const RELAY_API = "https://api.relay.link";
const NATIVE = "0x0000000000000000000000000000000000000000";
const BASE_CHAIN_ID = 8453;
const ROBINHOOD_CHAIN_ID = 4663;
const SOLANA_CHAIN_ID = 792703809;
const SOLANA_NATIVE = "11111111111111111111111111111111";
const QUOTE_TIMEOUT_MS = 8_000;

export type RelayBridgeQuote = {
  provider: "Relay";
  requestId: string;
  originChainId: 8453;
  destinationChainId: 4663;
  owner: Address;
  amountInWei: string;
  expectedAmountOutWei: string;
  minimumAmountOutWei: string;
  relayerFeeWei: string;
  relayerFeeUsd: string | null;
  impactPercent: string | null;
  estimatedSeconds: number | null;
  transaction: {
    to: Address;
    data: Hex;
    value: string;
    description: string;
  };
  statusPath: string;
  createdAt: string;
  expiresAt: string;
  notices: string[];
};

export type RelaySolanaQuote = {
  provider: "Relay";
  requestId: string;
  originChainId: 8453;
  destinationChainId: 792703809;
  owner: Address;
  recipient: string;
  amountInWei: string;
  expectedAmountOutLamports: string;
  minimumAmountOutLamports: string;
  relayerFeeWei: string;
  relayerFeeUsd: string | null;
  impactPercent: string | null;
  estimatedSeconds: number | null;
  transaction: {
    to: Address;
    data: Hex;
    value: string;
    description: string;
  };
  statusPath: string;
  createdAt: string;
  expiresAt: string;
  notices: string[];
};

export async function quoteBaseToRobinhoodEth(input: {
  owner: string;
  amountInWei: bigint;
}): Promise<RelayBridgeQuote> {
  if (!isAddress(input.owner)) throw new Error("owner must be a valid EVM address");
  if (input.amountInWei <= 0n) throw new Error("bridge amount must be positive");
  const owner = getAddress(input.owner);
  const response = await relayFetch("/quote/v2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user: owner,
      recipient: owner,
      originChainId: BASE_CHAIN_ID,
      destinationChainId: ROBINHOOD_CHAIN_ID,
      originCurrency: NATIVE,
      destinationCurrency: NATIVE,
      amount: input.amountInWei.toString(),
      tradeType: "EXACT_INPUT",
      useExternalLiquidity: false,
    }),
  });
  const quote = asRecord(await response.json());
  const requestId = requiredString(quote.requestId, "Relay requestId");
  const details = asRecord(quote.details);
  const currencyIn = asRecord(details.currencyIn);
  const currencyOut = asRecord(details.currencyOut);
  const inCurrency = asRecord(currencyIn.currency);
  const outCurrency = asRecord(currencyOut.currency);
  const step = firstRecord(quote.steps, "Relay deposit step");
  if (step.kind !== "transaction") throw new Error("Relay quote did not return a transaction step");
  const item = firstRecord(step.items, "Relay transaction item");
  const tx = asRecord(item.data);
  const protocol = asRecord(quote.protocol);
  const v2 = asRecord(protocol.v2);
  const paymentDetails = asRecord(v2.paymentDetails);

  const transaction = {
    from: requiredAddress(tx.from, "Relay transaction sender"),
    to: requiredAddress(tx.to, "Relay transaction target"),
    data: requiredHex(tx.data, "Relay transaction data"),
    value: requiredIntegerString(tx.value, "Relay transaction value"),
    chainId: requiredNumber(tx.chainId, "Relay transaction chainId"),
  };
  const depository = requiredAddress(paymentDetails.depository, "Relay depository");
  const expectedOut = requiredIntegerString(currencyOut.amount, "Relay expected output");
  const minimumOut = requiredIntegerString(currencyOut.minimumAmount, "Relay minimum output");
  const quotedIn = requiredIntegerString(currencyIn.amount, "Relay input amount");

  if (transaction.from.toLowerCase() !== owner.toLowerCase()) throw new Error("Relay sender does not match wallet");
  if (transaction.to.toLowerCase() !== depository.toLowerCase()) throw new Error("Relay target does not match its depository");
  if (transaction.chainId !== BASE_CHAIN_ID) throw new Error("Relay deposit must execute on Base");
  if (transaction.value !== input.amountInWei.toString() || quotedIn !== transaction.value) {
    throw new Error("Relay quote changed the requested input amount");
  }
  if (requiredNumber(inCurrency.chainId, "Relay input chain") !== BASE_CHAIN_ID) throw new Error("Relay input chain mismatch");
  if (requiredNumber(outCurrency.chainId, "Relay output chain") !== ROBINHOOD_CHAIN_ID) throw new Error("Relay output chain mismatch");
  if (requiredString(inCurrency.address, "Relay input currency").toLowerCase() !== NATIVE) throw new Error("Relay input must be native ETH");
  if (requiredString(outCurrency.address, "Relay output currency").toLowerCase() !== NATIVE) throw new Error("Relay output must be native ETH");
  if (BigInt(minimumOut) <= 0n || BigInt(expectedOut) < BigInt(minimumOut)) throw new Error("Relay returned an invalid output range");

  const fees = asRecord(quote.fees);
  const relayer = asRecord(fees.relayer);
  const totalImpact = asRecord(details.totalImpact);
  const now = new Date();
  return {
    provider: "Relay",
    requestId,
    originChainId: BASE_CHAIN_ID,
    destinationChainId: ROBINHOOD_CHAIN_ID,
    owner,
    amountInWei: quotedIn,
    expectedAmountOutWei: expectedOut,
    minimumAmountOutWei: minimumOut,
    relayerFeeWei: optionalIntegerString(relayer.amount) ?? "0",
    relayerFeeUsd: optionalString(relayer.amountUsd),
    impactPercent: optionalString(totalImpact.percent),
    estimatedSeconds: optionalNumber(details.timeEstimate),
    transaction: {
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
      description: "Relay Base → Robinhood Chain funding deposit",
    },
    statusPath: `/api/relay/status?requestId=${encodeURIComponent(requestId)}`,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    notices: [
      "Relay is an independent third-party bridge and charges the quoted relayer fee.",
      "The minimum destination amount includes Relay's quoted slippage tolerance.",
      "If the intent cannot be filled, Relay's protocol refund path returns funds to this wallet.",
    ],
  };
}

export async function quoteBaseToSolanaSol(input: {
  owner: string;
  recipient: string;
  amountInWei: bigint;
}): Promise<RelaySolanaQuote> {
  if (!isAddress(input.owner)) throw new Error("owner must be a valid EVM address");
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.recipient)) throw new Error("recipient must be a valid Solana address");
  if (input.amountInWei <= 0n) throw new Error("bridge amount must be positive");
  const owner = getAddress(input.owner);
  const response = await relayFetch("/quote/v2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user: owner,
      recipient: input.recipient,
      originChainId: BASE_CHAIN_ID,
      destinationChainId: SOLANA_CHAIN_ID,
      originCurrency: NATIVE,
      destinationCurrency: SOLANA_NATIVE,
      amount: input.amountInWei.toString(),
      tradeType: "EXACT_INPUT",
      useExternalLiquidity: true,
    }),
  });
  const quote = asRecord(await response.json());
  const requestId = requiredString(quote.requestId, "Relay requestId");
  const details = asRecord(quote.details);
  const currencyIn = asRecord(details.currencyIn);
  const currencyOut = asRecord(details.currencyOut);
  const inCurrency = asRecord(currencyIn.currency);
  const outCurrency = asRecord(currencyOut.currency);
  const step = firstRecord(quote.steps, "Relay deposit step");
  if (step.kind !== "transaction") throw new Error("Relay quote did not return a transaction step");
  const item = firstRecord(step.items, "Relay transaction item");
  const tx = asRecord(item.data);
  const protocol = asRecord(quote.protocol);
  const v2 = asRecord(protocol.v2);
  const paymentDetails = asRecord(v2.paymentDetails);

  const transaction = {
    from: requiredAddress(tx.from, "Relay transaction sender"),
    to: requiredAddress(tx.to, "Relay transaction target"),
    data: requiredHex(tx.data, "Relay transaction data"),
    value: requiredIntegerString(tx.value, "Relay transaction value"),
    chainId: requiredNumber(tx.chainId, "Relay transaction chainId"),
  };
  const depository = requiredAddress(paymentDetails.depository, "Relay depository");
  const expectedOut = requiredIntegerString(currencyOut.amount, "Relay expected output");
  const minimumOut = requiredIntegerString(currencyOut.minimumAmount, "Relay minimum output");
  const quotedIn = requiredIntegerString(currencyIn.amount, "Relay input amount");

  if (transaction.from.toLowerCase() !== owner.toLowerCase()) throw new Error("Relay sender does not match wallet");
  if (transaction.to.toLowerCase() !== depository.toLowerCase()) throw new Error("Relay target does not match its depository");
  if (transaction.chainId !== BASE_CHAIN_ID) throw new Error("Relay deposit must execute on Base");
  if (transaction.value !== input.amountInWei.toString() || quotedIn !== transaction.value) throw new Error("Relay quote changed the requested input amount");
  if (requiredNumber(inCurrency.chainId, "Relay input chain") !== BASE_CHAIN_ID) throw new Error("Relay input chain mismatch");
  if (requiredNumber(outCurrency.chainId, "Relay output chain") !== SOLANA_CHAIN_ID) throw new Error("Relay output chain mismatch");
  if (requiredString(inCurrency.address, "Relay input currency").toLowerCase() !== NATIVE) throw new Error("Relay input must be native ETH");
  if (requiredString(outCurrency.address, "Relay output currency") !== SOLANA_NATIVE) throw new Error("Relay output must be native SOL");
  if (BigInt(minimumOut) <= 0n || BigInt(expectedOut) < BigInt(minimumOut)) throw new Error("Relay returned an invalid output range");

  const fees = asRecord(quote.fees);
  const relayer = asRecord(fees.relayer);
  const totalImpact = asRecord(details.totalImpact);
  const now = new Date();
  return {
    provider: "Relay",
    requestId,
    originChainId: BASE_CHAIN_ID,
    destinationChainId: SOLANA_CHAIN_ID,
    owner,
    recipient: input.recipient,
    amountInWei: quotedIn,
    expectedAmountOutLamports: expectedOut,
    minimumAmountOutLamports: minimumOut,
    relayerFeeWei: optionalIntegerString(relayer.amount) ?? "0",
    relayerFeeUsd: optionalString(relayer.amountUsd),
    impactPercent: optionalString(totalImpact.percent),
    estimatedSeconds: optionalNumber(details.timeEstimate),
    transaction: {
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
      description: "Relay Base → Solana funding deposit",
    },
    statusPath: `/api/relay/status?requestId=${encodeURIComponent(requestId)}`,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    notices: [
      "Relay routes Base ETH into native SOL at this Privy-linked Solana address.",
      "The minimum destination amount includes Relay's quoted slippage tolerance.",
      "Solana liquidity transactions remain self-custodial and require this Solana wallet's signature.",
    ],
  };
}

export async function relayIntentStatus(requestId: string): Promise<unknown> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(requestId)) throw new Error("invalid Relay requestId");
  const response = await relayFetch(`/intents/status/v3?requestId=${encodeURIComponent(requestId)}`);
  return response.json();
}

async function relayFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${RELAY_API}${path}`, {
    ...init,
    headers: { accept: "application/json", ...init?.headers },
    signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Relay ${response.status}: ${message.slice(0, 240) || response.statusText}`);
  }
  return response;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Relay returned malformed data");
  return value as Record<string, unknown>;
}

function firstRecord(value: unknown, label: string): Record<string, unknown> {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} is missing`);
  return asRecord(value[0]);
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
