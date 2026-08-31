import { isAddress } from "viem";

export function sendValidationError({ owner, recipient, amountWei, balanceWei }: {
  owner: string;
  recipient: string;
  amountWei: bigint | null;
  balanceWei?: string;
}): string | null {
  if (!isAddress(recipient)) return "Enter a valid recipient address.";
  if (recipient.toLowerCase() === owner.toLowerCase()) return "Choose an address other than this Wizzy wallet.";
  if (amountWei === null || amountWei <= 0n) return "Enter an ETH amount greater than zero.";
  if (balanceWei === undefined) return "Your Robinhood Chain balance is still loading.";
  if (amountWei > BigInt(balanceWei)) return "This amount is above your available balance.";
  return null;
}
