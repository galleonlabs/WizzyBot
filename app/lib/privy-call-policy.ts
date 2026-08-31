type PrivyCall = {
  to: string;
  data: string;
  value: string;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_SEND_VALUE_WEI = 1_000n * 10n ** 18n;

/** Allow an arbitrary recipient only for one plain, value-bearing native ETH transfer. */
export function pureEthSendPolicyError(calls: readonly PrivyCall[]): { message: string; status: number } | null {
  if (calls.length !== 1) return { message: "ETH sends must contain exactly one transfer", status: 400 };
  const call = calls[0]!;
  if (call.data !== "0x") return { message: "ETH sends cannot include contract calldata", status: 403 };
  if (call.to.toLowerCase() === ZERO_ADDRESS) return { message: "ETH cannot be sent to the zero address", status: 400 };
  const value = BigInt(call.value);
  if (value <= 0n) return { message: "ETH send amount must be greater than zero", status: 400 };
  if (value > MAX_SEND_VALUE_WEI) return { message: "ETH send amount is above the wallet limit", status: 400 };
  return null;
}
