export type WalletTransaction = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  description: string;
};

export type EthereumProvider = {
  request(args: { method: string; params?: unknown[]; sponsor?: boolean }): Promise<unknown>;
};

export type ConnectedEvmWallet = {
  address: string;
  switchChain(chainId: number): Promise<unknown>;
  getEthereumProvider(): Promise<EthereumProvider>;
};

export type CallsSubmission = {
  id: string;
  chainId: number;
  callCount: number;
};

export type ConfirmedCallsSubmission = CallsSubmission & {
  status: unknown;
};

/** Extract only canonical EVM transaction hashes from wallet/Privy status shapes. */
export function confirmedTransactionHashes(value: unknown): `0x${string}`[] {
  const hashes = new Set<`0x${string}`>();
  collectTransactionHashes(value, hashes, 0);
  return [...hashes];
}

export type PrivyAuthorizationPayload = {
  version: 1;
  url: string;
  method: "POST";
  headers: { "privy-app-id": string };
  body: PrivySendCallsBody;
};

export type PrivySendCallsBody = {
  method: "wallet_sendCalls";
  caip2: `eip155:${number}`;
  chain_type: "ethereum";
  sponsor: true;
  params: {
    calls: Array<{ to: `0x${string}`; data: `0x${string}`; value: `0x${string}` }>;
  };
};

/** Request one self-custodial EIP-5792/7702 batch through the connected wallet. */
export async function sendWalletCalls(input: {
  wallet: ConnectedEvmWallet;
  owner: string;
  chainId: number;
  transactions: readonly WalletTransaction[];
}): Promise<CallsSubmission> {
  if (input.transactions.length === 0) throw new Error("transaction plan is empty");
  if (input.wallet.address.toLowerCase() !== input.owner.toLowerCase()) throw new Error("connected wallet does not match the plan owner");
  await input.wallet.switchChain(input.chainId);
  const provider = await input.wallet.getEthereumProvider();
  let result: unknown;
  try {
    result = await provider.request({
      method: "wallet_sendCalls",
      ...(input.chainId === 4663 ? { sponsor: true } : {}),
      params: [{
        from: input.owner,
        chainId: `0x${input.chainId.toString(16)}`,
        atomicRequired: true,
        calls: input.transactions.map((transaction) => ({
          to: transaction.to,
          data: transaction.data,
          value: toQuantity(transaction.value),
        })),
      }],
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`This wallet could not submit Wizzy's atomic batch. Use the Privy embedded wallet or another EIP-5792 wallet. ${detail}`);
  }
  const id = callsId(result);
  if (!id) throw new Error("wallet did not return a batch identifier");
  return { id, chainId: input.chainId, callCount: input.transactions.length };
}

export async function walletCallsStatus(provider: EthereumProvider, id: string): Promise<unknown> {
  return provider.request({ method: "wallet_getCallsStatus", params: [id] });
}

/** Submit one atomic batch and resolve only after the wallet reports a confirmed receipt. */
export async function sendWalletCallsAndWait(input: {
  wallet: ConnectedEvmWallet;
  owner: string;
  chainId: number;
  transactions: readonly WalletTransaction[];
  onSubmitted?: (submission: CallsSubmission) => void;
  timeoutMs?: number;
  pollingIntervalMs?: number;
}): Promise<ConfirmedCallsSubmission> {
  const submission = await sendWalletCalls(input);
  input.onSubmitted?.(submission);
  const provider = await input.wallet.getEthereumProvider();
  const status = await waitForWalletCalls({
    provider,
    id: submission.id,
    timeoutMs: input.timeoutMs,
    pollingIntervalMs: input.pollingIntervalMs,
  });
  return { ...submission, status };
}

/**
 * Submit a user-authorized Robinhood batch through Privy's Wallet API.
 * Privy, rather than the public chain RPC, owns EIP-5792 batching and gas sponsorship.
 */
export async function sendPrivyWalletCallsAndWait(input: {
  walletId: string;
  appId: string;
  owner: string;
  walletAddress: string;
  chainId: 4663;
  transactions: readonly WalletTransaction[];
  intent?: "send-eth";
  generateAuthorizationSignature(payload: PrivyAuthorizationPayload): Promise<{ signature: string }>;
  onSubmitted?: (submission: CallsSubmission) => void;
  timeoutMs?: number;
  pollingIntervalMs?: number;
  fetcher?: typeof fetch;
}): Promise<ConfirmedCallsSubmission> {
  if (input.transactions.length === 0) throw new Error("transaction plan is empty");
  if (input.walletAddress.toLowerCase() !== input.owner.toLowerCase()) throw new Error("connected wallet does not match the plan owner");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.walletId)) throw new Error("Privy wallet identifier is unavailable");
  const body = privySendCallsBody(input.chainId, input.transactions);
  const url = `https://api.privy.io/v1/wallets/${encodeURIComponent(input.walletId)}/rpc`;
  const { signature } = await input.generateAuthorizationSignature({
    version: 1,
    url,
    method: "POST",
    headers: { "privy-app-id": input.appId },
    body,
  });
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher("/api/privy/calls", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ walletId: input.walletId, body, signature, ...(input.intent ? { intent: input.intent } : {}) }),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) throw new Error(apiErrorMessage(payload, "Privy could not submit this atomic batch"));
  const id = callsId(payload);
  if (!id) throw new Error("Privy did not return a transaction identifier");
  const submission = { id, chainId: input.chainId, callCount: input.transactions.length };
  input.onSubmitted?.(submission);
  const status = await waitForPrivyTransaction({
    id,
    fetcher,
    timeoutMs: input.timeoutMs,
    pollingIntervalMs: input.pollingIntervalMs,
  });
  return { ...submission, status };
}

export function privySendCallsBody(chainId: 4663, transactions: readonly WalletTransaction[]): PrivySendCallsBody {
  return {
    method: "wallet_sendCalls",
    caip2: `eip155:${chainId}`,
    chain_type: "ethereum",
    sponsor: true,
    params: {
      calls: transactions.map((transaction) => ({
        to: transaction.to,
        data: transaction.data,
        value: toQuantity(transaction.value),
      })),
    },
  };
}

export async function waitForPrivyTransaction(input: {
  id: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  pollingIntervalMs?: number;
}): Promise<unknown> {
  const fetcher = input.fetcher ?? fetch;
  const timeoutMs = input.timeoutMs ?? 180_000;
  const pollingIntervalMs = input.pollingIntervalMs ?? 1_500;
  const startedAt = Date.now();
  let lastStatus: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetcher(`/api/privy/calls?transactionId=${encodeURIComponent(input.id)}`);
    lastStatus = await response.json() as unknown;
    if (!response.ok) throw new Error(apiErrorMessage(lastStatus, "Could not check the Privy transaction"));
    const terminal = privyTransactionTerminalState(lastStatus);
    if (terminal === "success") return lastStatus;
    if (terminal === "failure") throw new Error("The atomic transaction failed onchain. Your app did not show a success state.");
    await delay(pollingIntervalMs);
  }
  throw new Error("Robinhood is still confirming this transaction. Check your wallet activity before trying again.");
}

export function privyTransactionTerminalState(status: unknown): "pending" | "success" | "failure" {
  if (!status || typeof status !== "object") return "pending";
  const record = status as Record<string, unknown>;
  const value = String(record.status ?? "").toLowerCase();
  if (value === "confirmed" || value === "finalized") return "success";
  if (["execution_reverted", "failed", "replaced", "provider_error"].includes(value)) return "failure";
  return "pending";
}

export async function waitForWalletCalls(input: {
  provider: EthereumProvider;
  id: string;
  timeoutMs?: number;
  pollingIntervalMs?: number;
}): Promise<unknown> {
  const timeoutMs = input.timeoutMs ?? 120_000;
  const pollingIntervalMs = input.pollingIntervalMs ?? 1_200;
  const startedAt = Date.now();
  let lastStatus: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    lastStatus = await walletCallsStatus(input.provider, input.id);
    const terminal = callsTerminalState(lastStatus);
    if (terminal === "success") return lastStatus;
    if (terminal === "failure") throw new Error("The wallet batch failed onchain. No success state was shown; review the transaction and try again.");
    await delay(pollingIntervalMs);
  }
  throw new Error("The wallet is still confirming this transaction. Check your wallet activity before trying again.");
}

export function relaySucceeded(status: unknown): boolean {
  if (!status || typeof status !== "object") return false;
  const record = status as Record<string, unknown>;
  const value = String(record.status ?? record.state ?? "").toLowerCase();
  return value === "success" || value === "completed" || value === "filled";
}

export function callsTerminalState(status: unknown): "pending" | "success" | "failure" {
  if (!status || typeof status !== "object") return "pending";
  const record = status as Record<string, unknown>;
  const receipts = Array.isArray(record.receipts) ? record.receipts : [];
  if (receipts.some((receipt) => receipt && typeof receipt === "object" && String((receipt as Record<string, unknown>).status).toLowerCase() === "0x0")) {
    return "failure";
  }
  const raw = record.status ?? record.statusCode ?? record.state;
  if (typeof raw === "number") {
    if (raw >= 200 && raw < 300) return "success";
    if (raw >= 300) return "failure";
    return "pending";
  }
  const value = String(raw ?? "").toLowerCase();
  if (["200", "0xc8", "confirmed", "success", "completed", "filled"].includes(value)) return "success";
  if (["400", "500", "0x190", "0x1f4", "failed", "failure", "reverted", "rejected"].includes(value)) return "failure";
  return "pending";
}

function toQuantity(value: string): `0x${string}` {
  if (!/^\d+$/.test(value)) throw new Error("transaction value must be an integer string");
  return `0x${BigInt(value).toString(16)}`;
}

function callsId(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string") return record.id;
  if (typeof record.transaction_id === "string") return record.transaction_id;
  if (record.data && typeof record.data === "object") {
    const data = record.data as Record<string, unknown>;
    if (typeof data.transaction_id === "string") return data.transaction_id;
    if (typeof data.id === "string") return data.id;
  }
  return null;
}

function apiErrorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  return typeof record.error === "string" && record.error.length <= 300 ? record.error : fallback;
}

function collectTransactionHashes(value: unknown, hashes: Set<`0x${string}`>, depth: number) {
  if (depth > 5 || value === null || value === undefined) return;
  if (typeof value === "string") {
    if (/^0x[0-9a-fA-F]{64}$/.test(value)) hashes.add(value.toLowerCase() as `0x${string}`);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTransactionHashes(item, hashes, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (["transaction_hash", "transactionHash", "hash", "receipts", "receipt", "status"].includes(key)) {
      collectTransactionHashes(item, hashes, depth + 1);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
