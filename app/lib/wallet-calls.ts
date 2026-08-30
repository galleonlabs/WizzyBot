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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
