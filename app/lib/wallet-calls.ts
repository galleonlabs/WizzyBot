export type WalletTransaction = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  description: string;
};

export type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
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

export function relaySucceeded(status: unknown): boolean {
  if (!status || typeof status !== "object") return false;
  const record = status as Record<string, unknown>;
  const value = String(record.status ?? record.state ?? "").toLowerCase();
  return value === "success" || value === "completed" || value === "filled";
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
